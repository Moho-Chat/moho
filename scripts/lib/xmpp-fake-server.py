#!/usr/bin/env python3
"""A server that only ever says one stream error, for the sign-in probe: what moho does with `see-other-host`, with
`system-shutdown`, and so on, needs a server that sends them when asked, which a real one does not.

    xmpp-fake-server.py <port> <condition> [text-content]

XMPP_FAKE_CERT / XMPP_FAKE_KEY name another certificate and key to show (one the account does not trust, say).

It listens on 127.0.0.1:<port> with direct TLS (the test server's own certificate, so the account trusts it the same way),
answers each stream header with a header of its own and `<stream:error><condition>text-content</condition></stream:error>`,
and closes. It prints "ready" when listening and one line per connection it served.
"""
import os, socket, ssl, sys, threading

PKI = "/1tb/xmpp-test/pki"
port, condition = int(sys.argv[1]), sys.argv[2]
content = sys.argv[3] if len(sys.argv) > 3 else ""

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(os.environ.get("XMPP_FAKE_CERT", f"{PKI}/server.crt"), os.environ.get("XMPP_FAKE_KEY", f"{PKI}/server.key"))
ctx.set_alpn_protocols(["xmpp-client"])


def serve(conn):
    try:
        s = ctx.wrap_socket(conn, server_side=True)
        data = b""
        while b"<stream:stream" not in data or b">" not in data[data.find(b"<stream:stream"):]:
            chunk = s.recv(4096)
            if not chunk:
                return
            data += chunk
        s.sendall(
            b"<?xml version='1.0'?><stream:stream xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams' from='localhost' id='fake' version='1.0'>"
            + f"<stream:error><{condition} xmlns='urn:ietf:params:xml:ns:xmpp-streams'>{content}</{condition}></stream:error></stream:stream>".encode()
        )
        print("served", condition, flush=True)
        s.close()
    except Exception as e:  # a client that went away is not the probe's concern
        print("connection:", e, flush=True)


srv = socket.socket()
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", port))
srv.listen()
print("ready", flush=True)
while True:
    c, _ = srv.accept()
    threading.Thread(target=serve, args=(c,), daemon=True).start()
