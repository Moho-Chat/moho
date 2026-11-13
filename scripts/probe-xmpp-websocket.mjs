#!/usr/bin/env node
/**
 * XMPP over a WebSocket (RFC 7395): an account that signs in through the server's /websocket address, with a conversation each way
 * - the same stream code on another transport.
 *
 *   node scripts/probe-xmpp-websocket.mjs          (ejabberd)     XMPP_TEST_SERVER=prosody node scripts/probe-xmpp-websocket.mjs
 */
import { start, sleep, ca, SERVER } from './lib/xmpp-daemon.mjs'

const t = await start({ people: 2 })
const [me, you] = t.accounts
const myId = t.accountId(me)
const address = SERVER === 'prosody' ? 'wss://xmpp2.localhost:5291/xmpp-websocket' : 'wss://localhost:5443/websocket'
try {
  await t.rpc('addXmppAccount', { jid: me.jid, password: me.password, security: 'websocket', host: address, caPem: ca })
  t.check('the account signs in over a WebSocket', !!(await t.until(async () => (await t.state(me)) === 'connected', 20000)), await t.state(me))
  await sleep(1000)
  await t.rpc('xmppAddContact', { accountId: myId, jid: you.jid, name: 'Bea' })
  await t.peer(you, [{ wait_for: 'subscribe', timeout: 8 }, { accept: me.jid }, { sleep: 1 }])
  const b = await t.until(async () => (await t.rpc('listBuffers')).find((x) => x.accountId === myId && x.remoteId === you.jid) ?? null)
  t.check('the roster and presence work', !!b)
  await t.rpc('subscribe', { bufferId: b.id })
  await t.peer(you, [{ raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='w-1'><body>over the web</body><origin-id xmlns='urn:xmpp:sid:0' id='w-1'/></message>` }, { sleep: 1 }])
  t.check('a message arrives', !!t.seen('message', (d) => d.body === 'over the web'))
  await t.rpc('sendMessage', { bufferId: b.id, body: 'and back over the web' })
  const out = await t.peer(you, [{ wait_for: 'and back over the web', timeout: 8 }])
  t.check('and one is sent', out.received.includes('and back over the web'), out.received.slice(-300))
  // Dropping the socket resumes the session like any other transport.
} catch (err) {
  t.failed(err)
} finally {
  await t.finish()
}
