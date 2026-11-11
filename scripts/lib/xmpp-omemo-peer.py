#!/usr/bin/env python3
"""A second OMEMO client for the probes: slixmpp with the OMEMO plugin (python-omemo, written by other people), signed in as
one of the test accounts, with every new device blindly trusted. It talks the older namespace, which is the one moho speaks.

    xmpp-omemo-peer.py <name> '<json steps>'

Steps:
    {"send": "text", "to": "jid"}                  encrypt and send a chat message
    {"expect": "text", "timeout": 15}              wait until a decrypted message with this body arrives
    {"sleep": 1.5}
    {"send_to_devices": "text", "to": "jid"}      same as send (kept for clarity)
Prints {"ok": bool, "received": [decrypted bodies], "raw": "<all XML received>", "failed": "..."}.
"""
import asyncio, json, os, sys
import slixmpp
from slixmpp.plugins import register_plugin
from slixmpp_omemo import TrustLevel, XEP_0384
from omemo.storage import Just, Maybe, Nothing, Storage
from omemo.types import JSONType

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
        for p in ("xep_0030", "xep_0060", "xep_0163", "xep_0280", "xep_0334", "xep_0199", "xep_0004"):
            self.register_plugin(p)
        self.register_plugin("xep_0384")
        self.add_event_handler("session_start", self.started)
        self.add_event_handler("message", self.on_message)

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
        if msg["type"] not in ("chat", "normal"):
            return
        if not plugin.is_encrypted(msg):
            if msg["body"]:
                self.received.append("PLAIN:" + msg["body"])
            return
        try:
            decrypted, _ = await plugin.decrypt_message(msg)
            self.received.append(decrypted["body"])
        except Exception as e:  # noqa: BLE001
            self.received.append("UNREADABLE:" + repr(e))

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
            if "send" in step:
                await peer.send_encrypted(step["to"], step["send"])
            elif "sleep" in step:
                await asyncio.sleep(step["sleep"])
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
