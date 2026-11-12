#!/usr/bin/env python3
"""A second OMEMO client for the probes: slixmpp with the OMEMO plugin (python-omemo, written by other people), signed in as
one of the test accounts, with every new device blindly trusted. It publishes both namespaces, OMEMO 2 and the older one (with
XMPP_OMEMO_VERSIONS=old, only the older). The plugin stops short of reading OMEMO 2 (it has no Stanza Content Encryption), so the
envelope is opened here; what was read in OMEMO 2 is recorded twice, as the body and as "OMEMO2:<body>".

    xmpp-omemo-peer.py <name> '<json steps>'

Steps:
    {"send": "text", "to": "jid"}                  encrypt and send a chat message (the plugin's way: the older namespace)
    {"send2": "text", "to": "jid", "says_from": "jid"}   the same in OMEMO 2, the envelope saying it is from says_from (default: us)
    {"send_trust": [{"jid": j, "trust": [hex], "distrust": [hex]}], "to": "jid"}   an ATM trust message (XEP-0450) in OMEMO 2
    {"expect_start": "TRUST:", "timeout": 15}     wait until something received starts with this
    {"whoami": true}                               records "WHOAMI:<device id>:<identity key, Curve25519, hex>"
A trust message received is recorded as "TRUST:" + JSON [{"jid", "trust": [base64], "distrust": [base64]}].
    {"expect": "text", "timeout": 15}              wait until a decrypted message with this body arrives
    {"sleep": 1.5}
    {"send_to_devices": "text", "to": "jid"}      same as send (kept for clarity)
Prints {"ok": bool, "received": [decrypted bodies], "raw": "<all XML received>", "failed": "..."}.
"""
import asyncio, base64, json, os, ssl, sys, urllib.request
import slixmpp
from slixmpp.xmlstream.handler import CoroutineCallback
from slixmpp.xmlstream.matcher import MatchXPath
from slixmpp.plugins import register_plugin
from slixmpp_omemo import TrustLevel, XEP_0384
from omemo.storage import Just, Maybe, Nothing, Storage
from omemo.types import JSONType
import xml.etree.ElementTree as ET
import secrets
import omemo
import oldmemo
import twomemo

SCE = "urn:xmpp:sce:1"

OLD_ONLY = os.environ.get("XMPP_OMEMO_VERSIONS") == "old"
if OLD_ONLY:
    _create = omemo.SessionManager.create.__func__

    async def _old_only(cls, backends, *a, **kw):
        return await _create(cls, [b for b in backends if b.namespace == oldmemo.oldmemo.NAMESPACE], *a, **kw)

    omemo.SessionManager.create = classmethod(_old_only)

ACCOUNTS = os.environ.get("XMPP_TEST_ACCOUNTS", "/1tb/xmpp-test/accounts.txt")
CA = os.environ.get("XMPP_TEST_CA", "/1tb/xmpp-test/pki/ca.pem")
HOST = os.environ.get("XMPP_TEST_HOST", "127.0.0.1")
STATE = os.environ.get("XMPP_OMEMO_STATE", "")


class FileStorage(Storage):
    """The plugin's keys, kept in a JSON file so the same device is the same device on the next run."""

    def __init__(self, path):
        super().__init__(False)
        self.path = path
        self.data = {}
        if path and os.path.exists(path):
            self.data = json.load(open(path))

    def _save(self):
        if self.path:
            json.dump(self.data, open(self.path, "w"))

    async def _load(self, key: str) -> Maybe[JSONType]:
        return Just(self.data[key]) if key in self.data else Nothing()

    async def _store(self, key: str, value: JSONType) -> None:
        self.data[key] = value
        self._save()

    async def _delete(self, key: str) -> None:
        self.data.pop(key, None)
        self._save()


class Omemo(XEP_0384):
    default_config = {"fallback_message": "This message is OMEMO encrypted.", "state": ""}

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self._storage = FileStorage(STATE or None)

    @property
    def storage(self):
        return self._storage

    @property
    def _btbv_enabled(self):
        return True

    async def _devices_blindly_trusted(self, blindly_trusted, identifier):
        return None

    async def _prompt_manual_trust(self, manually_trusted, identifier):
        manager = await self.get_session_manager()
        for device in manually_trusted:
            await manager.set_trust(device.bare_jid, device.identity_key, TrustLevel.TRUSTED.value)


register_plugin(Omemo)


class Peer(slixmpp.ClientXMPP):
    def __init__(self, jid, password):
        super().__init__(jid, password)
        self.raw = []
        self.received = []
        self.ssl_context.load_verify_locations(cafile=CA)
        for p in ("xep_0030", "xep_0060", "xep_0163", "xep_0280", "xep_0334", "xep_0199", "xep_0004", "xep_0045"):
            self.register_plugin(p)
        self.register_plugin("xep_0384")
        self.add_event_handler("session_start", self.started)
        self.add_event_handler("message", self.on_message)
        # slixmpp raises "message" only for a message with a body; an empty OMEMO message (key transport) has none.
        self.register_handler(CoroutineCallback(
            "OMEMO without a body",
            MatchXPath("{jabber:client}message/{%s}encrypted" % twomemo.twomemo.NAMESPACE),
            self.on_bodyless,
        ))

    def data_received(self, data):
        self.raw.append(data.decode("utf-8", "replace") if isinstance(data, bytes) else str(data))
        super().data_received(data)

    async def started(self, _):
        self.send_presence()
        await self.get_roster()
        self["xep_0280"].enable if False else None
        # Wait for the plugin to have made and published this device.
        await self.get_session_manager_ready()
        self.ready.set_result(True)

    async def get_session_manager_ready(self):
        await self["xep_0384"].get_session_manager()

    async def on_message(self, msg):
        plugin = self["xep_0384"]
        if msg["type"] not in ("chat", "normal", "groupchat"):
            return
        if msg["type"] == "groupchat" and str(msg["from"].resource) == self.nick_in_room:
            return
        if not plugin.is_encrypted(msg):
            if msg["body"]:
                self.received.append("PLAIN:" + msg["body"])
            return
        newer = msg.xml.find("{%s}encrypted" % twomemo.twomemo.NAMESPACE)
        if newer is not None and OLD_ONLY:
            # A client of the older namespace does not look at OMEMO 2 at all (the plugin would, and fail).
            msg.xml.remove(newer)
            if msg.xml.find("{%s}encrypted" % oldmemo.oldmemo.NAMESPACE) is None:
                self.received.append("NOTHING-IN-THE-OLDER-NAMESPACE")
                return
        elif newer is not None:
            try:
                await self.read_v2(msg)
            except Exception as e:  # noqa: BLE001
                self.received.append("UNREADABLE:" + repr(e))
            return
        try:
            decrypted, _ = await plugin.decrypt_message(msg)
            self.received.append(decrypted["body"])
        except Exception as e:  # noqa: BLE001
            self.received.append("UNREADABLE:" + repr(e))

    nick_in_room = "peer"

    async def on_bodyless(self, msg):
        if not msg["body"]:
            await self.on_message(msg)

    async def read_v2(self, msg):
        """OMEMO 2, read the way the specification says: the session manager decrypts, the SCE envelope is opened here."""
        sender = msg["from"].bare
        if msg["type"] == "groupchat":
            sender = slixmpp.JID(self["xep_0045"].get_jid_property(msg["from"].bare, msg["from"].resource, "jid")).bare
        message = twomemo.etree.parse_message(msg.xml.find("{%s}encrypted" % twomemo.twomemo.NAMESPACE), sender)
        manager = await self["xep_0384"].get_session_manager()
        plaintext = (await manager.decrypt(message))[0]
        if plaintext is None:
            self.received.append("EMPTY2")
            return
        envelope = ET.fromstring(plaintext)
        trust = envelope.find("{%s}content/{urn:xmpp:tm:1}trust-message" % SCE)
        if trust is not None:
            owners = [{"jid": o.get("jid"), "trust": [t.text for t in o.findall("{urn:xmpp:tm:1}trust")], "distrust": [t.text for t in o.findall("{urn:xmpp:tm:1}distrust")]} for o in trust.findall("{urn:xmpp:tm:1}key-owner")]
            self.received.append("TRUST:" + json.dumps(owners))
            return
        body = envelope.find("{%s}content/{jabber:client}body" % SCE)
        said = envelope.find("{%s}from" % SCE)
        if said is None or slixmpp.JID(said.get("jid")).bare != sender:
            self.received.append("WRONG-FROM:" + (said.get("jid") if said is not None else ""))
            return
        text = body.text if body is not None else ""
        self.received.append(text)
        self.received.append("OMEMO2:" + text)

    async def send_trust(self, to, owners):
        tm = ET.Element("{urn:xmpp:tm:1}trust-message", {"usage": "urn:xmpp:atm:1", "encryption": twomemo.twomemo.NAMESPACE})
        for o in owners:
            owner = ET.SubElement(tm, "{urn:xmpp:tm:1}key-owner", {"jid": o["jid"]})
            for kind in ("trust", "distrust"):
                for h in o.get(kind, []):
                    ET.SubElement(owner, "{urn:xmpp:tm:1}" + kind).text = base64.b64encode(bytes.fromhex(h)).decode()
        await self.send_v2(to, None, content=[tm])

    async def whoami(self):
        import xeddsa
        manager = await self["xep_0384"].get_session_manager()
        own = (await manager.get_own_device_information())[0]
        self.received.append("WHOAMI:%d:%s" % (own.device_id, xeddsa.ed25519_pub_to_curve25519_pub(own.identity_key).hex()))

    async def send_v2(self, to, text, says_from=None, mtype="chat", recipients=None, content=None):
        recipients = [slixmpp.JID(r) for r in (recipients or [to])]
        plugin = self["xep_0384"]
        # Forced: subscribed to the person, the plugin would otherwise wait for the server to push their device list.
        await plugin.refresh_device_lists(set(recipients), force_download=True)
        envelope = ET.Element("{%s}envelope" % SCE)
        inner = ET.SubElement(envelope, "{%s}content" % SCE)
        if text is not None:
            ET.SubElement(inner, "{jabber:client}body").text = text
        for e in content or []:
            inner.append(e)
        ET.SubElement(envelope, "{%s}rpad" % SCE).text = secrets.token_hex(secrets.randbelow(16) + 1)
        ET.SubElement(envelope, "{%s}from" % SCE, {"jid": says_from or self.boundjid.bare})
        manager = await plugin.get_session_manager()
        messages, errors = await manager.encrypt(
            frozenset(r.bare for r in recipients),
            {twomemo.twomemo.NAMESPACE: ET.tostring(envelope)},
            backend_priority_order=[twomemo.twomemo.NAMESPACE],
            identifier=None,
        )
        if not messages:
            raise RuntimeError("could not encrypt: %r" % (errors,))
        msg = self.make_message(mto=to, mtype=mtype)
        msg["body"] = "This message is OMEMO encrypted."
        msg.enable("store")
        for m in messages:
            msg.append(twomemo.etree.serialize_message(m))
        msg.send()

    async def send_room(self, room, text, recipients):
        msg = self.make_message(mto=room, mtype="groupchat")
        msg["body"] = text
        msg.set_to(room)
        msg.set_from(self.boundjid)
        encrypted, errors = await self["xep_0384"].encrypt_message(msg, {slixmpp.JID(r) for r in recipients})
        if encrypted is None:
            raise RuntimeError("could not encrypt: %r" % (errors,))
        encrypted.send()

    def fetch_aesgcm(self, url):
        """Fetch an encrypted file from its aesgcm:// link and decrypt it, as another client would."""
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        rest = url[len("aesgcm://"):]
        path, fragment = rest.split("#")
        raw = bytes.fromhex(fragment)
        iv, key = raw[:-32], raw[-32:]
        ctx = ssl.create_default_context(cafile=CA)
        data = urllib.request.urlopen("https://" + path, context=ctx).read()
        return AESGCM(key).decrypt(iv, data, None)

    async def send_encrypted(self, to, text):
        msg = self.make_message(mto=to, mtype="chat")
        msg["body"] = text
        msg.set_to(to)
        msg.set_from(self.boundjid)
        encrypted, errors = await self["xep_0384"].encrypt_message(msg, slixmpp.JID(to))
        if encrypted is None:
            raise RuntimeError("could not encrypt: %r" % (errors,))
        encrypted.send()


async def main():
    if os.environ.get("XMPP_PEER_DEBUG"):
        import logging
        logging.basicConfig(level=logging.DEBUG, stream=sys.stderr)
    name, steps = sys.argv[1], json.loads(sys.argv[2])
    accounts = dict(l.split() for l in open(ACCOUNTS).read().splitlines() if l.strip())
    jid = next(j for j in accounts if j.split("@")[0] == name)
    peer = Peer(jid, accounts[jid])
    peer.ready = asyncio.get_event_loop().create_future()
    peer.connect(HOST, int(os.environ.get('XMPP_TEST_PORT', '5222')))
    await asyncio.wait_for(peer.ready, 30)
    failed = None
    for step in steps:
        try:
            if "send_trust" in step:
                await peer.send_trust(step["to"], step["send_trust"])
            elif "whoami" in step:
                await peer.whoami()
            elif "send2" in step:
                await peer.send_v2(step["to"], step["send2"], step.get("says_from"), step.get("type", "chat"), step.get("recipients"))
            elif "send" in step:
                await peer.send_encrypted(step["to"], step["send"])
            elif "join" in step:
                peer.nick_in_room = step.get("nick", "peer")
                peer.plugin["xep_0045"].join_muc(step["join"], peer.nick_in_room)
                await asyncio.sleep(step.get("wait", 2))
            elif "send_room" in step:
                await peer.send_room(step["room"], step["send_room"], step["recipients"])
            elif "expect_file" in step:
                end = asyncio.get_event_loop().time() + step.get("timeout", 15)
                found = None
                while found is None:
                    for r in peer.received:
                        if r.startswith("aesgcm://"):
                            found = r
                    if found is None:
                        if asyncio.get_event_loop().time() > end:
                            raise TimeoutError("no encrypted file link arrived")
                        await asyncio.sleep(0.1)
                content = peer.fetch_aesgcm(found)
                if content.decode("utf-8", "replace") != step["expect_file"]:
                    raise ValueError("the file's contents were %r" % content[:50])
                peer.received.append("FILE-OK:" + step["expect_file"])
            elif "sleep" in step:
                await asyncio.sleep(step["sleep"])
            elif "expect_start" in step:
                end = asyncio.get_event_loop().time() + step.get("timeout", 15)
                while not any(r.startswith(step["expect_start"]) for r in peer.received):
                    if asyncio.get_event_loop().time() > end:
                        raise TimeoutError(step["expect_start"])
                    await asyncio.sleep(0.1)
            elif "expect" in step:
                end = asyncio.get_event_loop().time() + step.get("timeout", 15)
                while step["expect"] not in peer.received:
                    if asyncio.get_event_loop().time() > end:
                        raise TimeoutError(step["expect"])
                    await asyncio.sleep(0.1)
        except Exception as e:  # noqa: BLE001
            failed = f"{step}: {e!r}"
            break
    await asyncio.sleep(0.3)
    peer.disconnect()
    await asyncio.sleep(0.3)
    print(json.dumps({"ok": failed is None, "received": peer.received, "raw": "".join(peer.raw)[-4000:], "failed": failed}))


asyncio.run(main())
