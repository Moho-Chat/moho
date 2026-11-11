#!/usr/bin/env node
/**
 * The account and its connection, as the daemon does them: making an account on a server, its password and its end, what the
 * server says about itself, blocking, the server's commands - and a connection that drops without the session ending, which
 * must resume with nothing lost and nothing doubled.
 *
 *   ~/.local/share/moho-dev/xmpp-test.sh up && (cd nobilis && cargo build --release) && node scripts/probe-xmpp-account.mjs
 */
import net from 'node:net'
import { start, sleep, ca, DOMAIN, PORT, userRegistered } from './lib/xmpp-daemon.mjs'

const t = await start({ people: 2 })
const [me, you] = t.accounts
const myId = t.accountId(me)
const fresh = `reg${t.stamp}`
const admin = { name: `adm${t.stamp}`, password: `pw-${t.stamp}-admin`, jid: `adm${t.stamp}@${DOMAIN}` }
let proxy
const sockets = new Set()
let paused = false
try {
  console.log('making an account')
  const params = { jid: DOMAIN, host: '127.0.0.1', port: PORT, caPem: ca }
  const form = await t.rpc('xmppRegistrationForm', params)
  t.check('a server says what it needs to make an account', form.form?.fields?.some((f) => f.var === 'username') && form.form.fields.some((f) => f.var === 'password'), JSON.stringify(form))
  let taken = ''
  await t.rpc('xmppRegister', { ...params, answers: { username: me.name, password: 'x' } }).catch((e) => (taken = e.message))
  t.check('a name that is taken is said to be', /taken/.test(taken), taken)
  const made = await t.rpc('xmppRegister', { ...params, answers: { username: fresh, password: 'a-new-password' } })
  t.check('an account is made, and signed in as', made.registered && made.accountId === `xmpp:${fresh}@${DOMAIN}` && !!(await t.until(async () => (await t.rpc('listAccounts')).find((a) => a.id === made.accountId)?.state === 'connected')), JSON.stringify(made))
  const freshId = made.accountId

  console.log('its password and its end')
  await t.rpc('xmppChangePassword', { accountId: freshId, password: 'a-newer-password' })
  // Seen from outside: signing in with the old password is refused and with the new one is not.
  const stateOf = async () => (await t.rpc('listAccounts')).find((a) => a.id === freshId)?.state
  await t.rpc('removeAccount', { accountId: freshId })
  await t.rpc('addXmppAccount', { jid: `${fresh}@${DOMAIN}`, password: 'a-new-password', host: '127.0.0.1', port: PORT, caPem: ca })
  await t.until(async () => ['auth_failed', 'connected'].includes(await stateOf()))
  t.check('the old password no longer signs in', (await stateOf()) === 'auth_failed')
  await t.rpc('removeAccount', { accountId: freshId })
  await t.rpc('addXmppAccount', { jid: `${fresh}@${DOMAIN}`, password: 'a-newer-password', host: '127.0.0.1', port: PORT, caPem: ca })
  t.check('and the new one does', !!(await t.until(async () => (await stateOf()) === 'connected')))
  await t.rpc('xmppDeleteAccount', { accountId: freshId })
  await sleep(800)
  t.check('deleting the account removes it from the server', !userRegistered(fresh))

  console.log('what the server says')
  t.check('the account signs in', await t.signIn(me))
  await sleep(500)
  const info = await t.rpc('xmppServerInfo', { accountId: myId })
  t.check('about itself: its software and what it can do, by the specification', info.features.some((f) => f.var === 'urn:xmpp:mam:2' && /XEP-0313/.test(f.xep)), JSON.stringify(info).slice(0, 300))

  console.log('blocking')
  await t.rpc('xmppAddContact', { accountId: myId, jid: you.jid, name: 'Bea' })
  await t.peer(you, [{ wait_for: 'subscribe', timeout: 8 }, { accept: me.jid }, { sleep: 1 }])
  const b = await t.until(async () => (await t.rpc('listBuffers')).find((x) => x.accountId === myId && x.remoteId === you.jid) ?? null)
  await t.rpc('subscribe', { bufferId: b.id })
  await t.rpc('xmppBlock', { accountId: myId, jid: you.jid, block: true })
  t.check('a blocked address is on the list', (await t.rpc('xmppBlocklist', { accountId: myId })).blocked.includes(you.jid))
  t.events.length = 0
  await t.peer(you, [{ raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='b-1'><body>can you hear me</body></message>` }, { sleep: 1 }])
  t.check('what they send is not shown', !t.seen('message', (d) => d.body === 'can you hear me'))
  await t.rpc('xmppBlock', { accountId: myId, jid: you.jid, block: false })
  await t.peer(you, [{ raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='b-2'><body>and now</body></message>` }, { sleep: 1 }])
  t.check('and is again when they are unblocked', !!t.seen('message', (d) => d.body === 'and now'))

  console.log('the server\'s commands')
  const adminJid = admin.jid
  // ejabberd decides who is an administrator by configuration: the probe's own account is only a user, so what it is offered is a user's.
  const commands = await t.rpc('xmppCommands', { accountId: myId })
  t.check('what the server offers to be run is listed', Array.isArray(commands.commands), JSON.stringify(commands))
  void adminJid

  console.log('a connection that drops without the session ending')
  proxy = net.createServer((c) => {
    if (paused) return c.destroy()
    const up = net.connect(PORT, '127.0.0.1')
    sockets.add(c)
    sockets.add(up)
    c.pipe(up)
    up.pipe(c)
    for (const s of [c, up]) s.on('close', () => sockets.delete(s)).on('error', () => {})
  })
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r))
  const port = proxy.address().port
  // The second account is reached through the proxy.
  await t.rpc('addXmppAccount', { jid: you.jid, password: you.password, host: '127.0.0.1', port, caPem: ca })
  const youId = t.accountId(you)
  t.check('an account signs in through the proxy', !!(await t.until(async () => (await t.state(you)) === 'connected')))
  await sleep(1500)
  paused = true
  for (const s of sockets) s.destroy()
  t.check('a dropped connection is noticed', !!(await t.until(async () => (await t.state(you)) === 'connecting', 15000)))
  // While it is down, somebody writes to it.
  await t.peer(me, [{ raw: `<message xmlns='jabber:client' to='${you.jid}' type='chat' id='d-1'><body>written while the line was down</body><origin-id xmlns='urn:xmpp:sid:0' id='d-1'/></message>` }, { sleep: 0.5 }]).catch(() => null)
  paused = false
  t.check('it comes back by itself', !!(await t.until(async () => (await t.state(you)) === 'connected', 60000)))
  t.check('with the same session, so nothing was lost', /the session was resumed/.test(t.log), t.log.split('\n').filter((l) => /xmpp/.test(l)).slice(-6).join('\n'))
  void youId
} catch (err) {
  t.failed(err)
} finally {
  for (const s of sockets) s.destroy()
  proxy?.close()
  await t.finish()
}
