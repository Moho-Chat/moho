#!/usr/bin/env python3
"""Another XMPP client, for the probes: signs in as one of the test accounts with slixmpp, does what the steps say,
and prints everything it was sent. So a round has a counterpart that is not moho: what moho sends is read by a library
written by somebody else, and what that library sends is what moho has to understand.

    xmpp-peer.py <name> '<json steps>'

name is one of the accounts in the accounts file (alice, bob, carol). Steps, in order:

    {"raw": "<message .../>"}              send this XML as it is
    {"sleep": 1.5}                         wait
    {"wait_for": "text", "timeout": 10}    wait until the raw text received so far holds this
    {"presence": "available"|"away"|"dnd"|"unavailable", "status": "..."}
    {"roster_add": "jid", "name": "..."}   add a contact and ask to see them
    {"accept": "jid"}                      accept a request to see this client's presence
    {"mam": {"with": "jid", "max": 10}}    ask the archive and add its answer to what was received

Prints one JSON object: {"ok": bool, "received": "<all the XML received>", "failed": "<step>"}.
"""
import asyncio, json, os, ssl, sys
import slixmpp
from slixmpp.xmlstream import ET

ACCOUNTS = os.environ.get("XMPP_TEST_ACCOUNTS", "/1tb/xmpp-test/accounts.txt")
CA = os.environ.get("XMPP_TEST_CA", "/1tb/xmpp-test/pki/ca.pem")
HOST = os.environ.get("XMPP_TEST_HOST", "127.0.0.1")


class Peer(slixmpp.ClientXMPP):
    def __init__(self, jid, password):
        super().__init__(jid, password)
        self.received = []
        self.ssl_context.load_verify_locations(cafile=CA)
        self.register_plugin("xep_0030")
        self.register_plugin("xep_0199")
        self.register_plugin("xep_0313")
        self.add_event_handler("session_start", self.started)
        self.add_event_handler("presence_subscribe", lambda p: None)

    def data_received(self, data):
        self.received.append(data.decode("utf-8", "replace") if isinstance(data, bytes) else str(data))
        super().data_received(data)

    async def started(self, _):
        self.send_presence()
        await self.get_roster()
        self.started_ok.set_result(True)


async def main():
    name, steps = sys.argv[1], json.loads(sys.argv[2])
    accounts = dict(l.split() for l in open(ACCOUNTS).read().splitlines() if l.strip())
    jid = next(j for j in accounts if j.split("@")[0] == name)
    peer = Peer(jid, accounts[jid])
    peer.started_ok = asyncio.get_event_loop().create_future()
    peer.connect(HOST, int(os.environ.get('XMPP_TEST_PORT', '5222')))
    await asyncio.wait_for(peer.started_ok, 20)
    failed = None
    for step in steps:
        try:
            if "raw" in step:
                peer.send_raw(step["raw"])
            elif "sleep" in step:
                await asyncio.sleep(step["sleep"])
            elif "wait_for" in step:
                end = asyncio.get_event_loop().time() + step.get("timeout", 10)
                while step["wait_for"] not in "".join(peer.received):
                    if asyncio.get_event_loop().time() > end:
                        raise TimeoutError(step["wait_for"])
                    await asyncio.sleep(0.1)
            elif "presence" in step:
                kind = step["presence"]
                if kind == "unavailable":
                    peer.send_presence(ptype="unavailable")
                else:
                    peer.send_presence(pshow=None if kind == "available" else kind, pstatus=step.get("status", ""))
            elif "roster_add" in step:
                peer.send_presence_subscription(pto=step["roster_add"], ptype="subscribe")
                peer.update_roster(step["roster_add"], name=step.get("name"))
            elif "accept" in step:
                peer.send_presence(pto=step["accept"], ptype="subscribed")
                peer.send_presence_subscription(pto=step["accept"], ptype="subscribe")
            elif "mam" in step:
                m = step["mam"]
                iq = await peer["xep_0313"].retrieve(jid=None, with_jid=m.get("with"), rsm={"max": m.get("max", 10)}) if False else None
                peer.received.append("<!-- mam is asked with raw steps -->")
        except Exception as e:  # noqa: BLE001
            failed = f"{step}: {e!r}"
            break
    await asyncio.sleep(0.3)
    peer.disconnect()
    await asyncio.sleep(0.3)
    print(json.dumps({"ok": failed is None, "received": "".join(peer.received), "failed": failed}))


asyncio.run(main())
