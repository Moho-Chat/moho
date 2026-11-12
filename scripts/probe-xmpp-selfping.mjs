#!/usr/bin/env node
/**
 * Staying in a room: one whose service restarts (status 332) is joined again by itself once the service is back, and what is
 * said there afterwards arrives; after a resumption the account asks each room whether it is still in it (MUC self-ping,
 * XEP-0410), and one that stayed answers so (a room that dropped the account without a word is rejoined - the decision is
 * unit-tested: neither test server drops anybody silently). Also /me (XEP-0245): a line that begins with it is an action,
 * both ways.
 *
 *   node scripts/probe-xmpp-selfping.mjs      (ejabberd: restarting mod_muc empties every room, saying so with 332)
 */
import net from 'node:net'
import { start, sleep, ca, PORT, CONF, DOMAIN, ctl } from './lib/xmpp-daemon.mjs'

// The self-ping's answers are said at debug level.
process.env.RUST_LOG = `${process.env.RUST_LOG ?? 'info'},nobilis::backend::xmpp::muc=debug`

const t = await start({ people: 2 })
const [me, you] = t.accounts
const myId = t.accountId(me)
const room = `ping${t.stamp}@${CONF}`
// A relay, so the connection can be cut and resumed without the server noticing.
const pairs = new Set()
const relay = net.createServer((c) => {
  const u = net.connect(PORT, '127.0.0.1')
  const p = { c, u }
  pairs.add(p)
  c.pipe(u)
  u.pipe(c)
  const end = () => (c.destroy(), u.destroy(), pairs.delete(p))
  c.on('error', end).on('close', end)
  u.on('error', end).on('close', end)
}).listen(5287, '127.0.0.1')
const backlog = async (bufferId) => ((await t.rpc('getBacklog', { bufferId, limit: 100 })) ?? [])
try {
  await t.rpc('addXmppAccount', { jid: me.jid, password: me.password, host: '127.0.0.1', port: 5287, caPem: ca })
  t.check('it signs in', !!(await t.until(async () => (await t.state(me)) === 'connected', 20000)))
  const r = await t.rpc('xmppJoinRoom', { accountId: myId, jid: room, nick: 'mohonick', bookmark: false })
  await sleep(1500)
  await t.rpc('xmppSetRoomConfig', { bufferId: r.bufferId, answers: { 'muc#roomconfig_persistentroom': true } })
  await sleep(1000)

  console.log('/me')
  await t.rpc('sendMessage', { bufferId: r.bufferId, body: '/me waves' })
  await sleep(1000)
  const mine = (await backlog(r.bufferId)).find((m) => m.body === 'waves')
  t.check('a /me line is an action, its words what follows', mine?.isAction === true, JSON.stringify(mine))
  const heard = await t.peer(you, [{ raw: `<presence xmlns='jabber:client' to='${room}/pat'><x xmlns='http://jabber.org/protocol/muc'/></presence>` }, { sleep: 1 }, { raw: `<message xmlns='jabber:client' to='${room}' type='groupchat' id='me-1'><body>/me waves back</body></message>` }, { sleep: 1 }])
  t.check('and written as /me for the others (XEP-0245)', heard.received.includes('/me waves'))
  t.check("another's /me is an action here", !!(await t.until(async () => (await backlog(r.bufferId)).find((m) => m.body === 'waves back' && m.isAction), 6000)))

  console.log('after a resumption')
  for (const p of pairs) p.c.destroy()
  t.check('the account asks the room whether it is still in it, and is', !!(await t.until(async () => t.log.includes(`self-ping of ${room}: Ok`), 30000)), t.log.split('\n').filter((l) => /self-ping|resumed/.test(l)).slice(-4).join('\n'))

  console.log("a room whose service restarts")
  ctl('restart_module', DOMAIN, 'mod_muc')
  t.check('says so', !!(await t.until(async () => (await backlog(r.bufferId)).some((m) => /service is shutting down/.test(m.body)), 10000)))
  t.check('and is joined again by itself once the service is back', !!(await t.until(async () => t.log.includes(`joining ${room} again after its service restarted`) && (await t.rpc('listBuffers')).find((b) => b.id === r.bufferId)?.readOnly == null, 40000)))
  await sleep(1500)
  await t.peer(you, [{ raw: `<presence xmlns='jabber:client' to='${room}/pat'><x xmlns='http://jabber.org/protocol/muc'/></presence>` }, { sleep: 1 }, { raw: `<message xmlns='jabber:client' to='${room}' type='groupchat' id='after'><body>are you still there</body></message>` }, { sleep: 1.5 }])
  t.check('and what is said there afterwards arrives', !!(await t.until(async () => (await backlog(r.bufferId)).some((m) => m.body === 'are you still there'), 8000)))
} catch (err) {
  t.failed(err)
} finally {
  relay.close()
  await t.finish()
}
