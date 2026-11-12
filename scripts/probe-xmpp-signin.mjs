#!/usr/bin/env node
/**
 * Signing in and staying signed in, as the server sees it: the SASL mechanism and channel binding chosen, SASL2 with Bind2 and
 * FAST where the server has them, a sign-in token used and a refused one dropped; a connection cut in the middle of a session
 * and resumed with nothing lost, and one the server forgot, begun afresh and caught up from the archive; and the stream errors a
 * server can end a session with - another device taking the resource, `see-other-host`, `system-shutdown` - each handled and
 * said in words.
 *
 *   node scripts/probe-xmpp-signin.mjs          (ejabberd: SASL2, Bind2, FAST)
 *   XMPP_TEST_SERVER=prosody node scripts/probe-xmpp-signin.mjs     (Prosody 13: RFC 6120 SASL, SCRAM-SHA-1-PLUS)
 *
 * The connection goes through a TCP relay of the probe's own, so it can be cut without the server knowing; the stream errors
 * come from `lib/xmpp-fake-server.py`, which says one and closes.
 */
import { spawn, execFile } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'
import { start, sleep, ca, SERVER, PORT, ctl } from './lib/xmpp-daemon.mjs'
import { root } from './lib/harness.mjs'

const run = promisify(execFile)
const ejabberd = SERVER !== 'prosody'
const DIRECT = ejabberd ? 5223 : 5233

/** A relay to the server that can be cut: every connection through it is closed at once, and new ones are let through. */
function relay(port, target) {
  const pairs = new Set()
  let blackhole = false
  const server = net.createServer((client) => {
    const upstream = net.connect(target, '127.0.0.1')
    const pair = { client, upstream }
    pairs.add(pair)
    client.on('data', (d) => !blackhole && upstream.write(d))
    upstream.on('data', (d) => !blackhole && client.write(d))
    const end = () => {
      client.destroy()
      upstream.destroy()
      pairs.delete(pair)
    }
    client.on('error', end).on('close', end)
    upstream.on('error', end).on('close', end)
  })
  server.listen(port, '127.0.0.1')
  return {
    cut: () => [...pairs].forEach(({ client, upstream }) => (client.destroy(), upstream.destroy())),
    /** Silence both ways without closing: a connection a sleeping laptop left half-open. */
    silence: (on) => (blackhole = on),
    count: () => pairs.size,
    close: () => server.close()
  }
}

function fakeServer(port, condition, content = '') {
  const p = spawn('/1tb/xmpp-test/venv/bin/python', ['-I', path.join(root, 'scripts/lib/xmpp-fake-server.py'), String(port), condition, content], { stdio: ['ignore', 'pipe', 'inherit'] })
  let out = ''
  p.stdout.on('data', (d) => (out += d))
  process.on('exit', () => p.kill('SIGKILL'))
  return { ready: async () => { for (let i = 0; i < 50 && !out.includes('ready'); i++) await sleep(100) }, served: () => (out.match(/served/g) ?? []).length, kill: () => p.kill('SIGKILL') }
}

const t = await start({ people: 3 })
const [me, you, third] = t.accounts
const myId = t.accountId(me)
const linesOf = (re) => t.log.split('\n').filter((l) => re.test(l))
const relayPort = 5298 + (ejabberd ? 0 : 10)
const r = relay(relayPort, PORT)
try {
  console.log(`signing in (${SERVER})`)
  await t.rpc('addXmppAccount', { jid: me.jid, password: me.password, host: '127.0.0.1', port: relayPort, caPem: ca })
  t.check('it signs in', !!(await t.until(async () => (await t.state(me)) === 'connected', 20000)), await t.state(me))
  const signedIn = linesOf(new RegExp(`xmpp\\[${myId}\\]: signed in with`))
  if (ejabberd) {
    t.check('with the strongest SCRAM, bound to the TLS channel, over SASL2 with Bind2', signedIn.some((l) => l.includes('signed in with SCRAM-SHA-512-PLUS over SASL2, bound inline (Bind2)')), signedIn.join('\n'))
  } else {
    t.check('with SCRAM-SHA-1-PLUS bound to tls-exporter (all Prosody offers), over RFC 6120 SASL', signedIn.some((l) => l.includes('signed in with SCRAM-SHA-1-PLUS')) && linesOf(/moho uses SCRAM-SHA-1-PLUS bound to tls-exporter/).length > 0, signedIn.join('\n'))
  }
  let toml = t.accountsToml()
  t.check('the floor is kept: PLAIN will not be used for this account from now on', /sasl_floor = "scram"/.test(toml))
  t.check('the user agent has an id of its own, a UUID', /user_agent_id = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"/.test(toml))
  t.check('when it last signed in is kept', /last_connected = "20\d\d-/.test(toml))
  if (ejabberd) t.check('a FAST token was given and kept, with its mechanism', /fast_token = "[^"]+"/.test(toml) && /fast_mechanism = "HT-SHA-256-(EXPR|ENDP)"/.test(toml), toml.split('\n').filter((l) => l.startsWith('fast')).join(' '))
  const resource = /resource = "([^"]+)"/.exec(toml)?.[1]

  // A conversation to see messages cross a drop in.
  await t.peer(you, [{ raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='s-0'><body>hello before</body></message>` }, { sleep: 1 }])
  const b = await t.until(async () => (await t.rpc('listBuffers')).find((x) => x.accountId === myId && x.remoteId === you.jid) ?? null)
  t.check('a conversation to watch', !!b)
  await t.rpc('subscribe', { bufferId: b.id })

  console.log('a connection cut without the server knowing')
  const resumedBefore = linesOf(/session was resumed/).length
  r.cut()
  await t.peer(you, [{ raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='s-1'><body>sent while you were cut off</body></message>` }, { sleep: 0.5 }])
  await t.rpc('sendMessage', { bufferId: b.id, body: 'written while cut off' }).catch(() => null)
  t.check('the session is resumed (XEP-0198), not begun again', !!(await t.until(async () => linesOf(/session was resumed/).length > resumedBefore, 30000)), linesOf(/xmpp\[/).slice(-8).join('\n'))
  t.check('and it is connected', !!(await t.until(async () => (await t.state(me)) === 'connected', 10000)))
  t.check('what was sent to it meanwhile arrives', !!(await t.until(async () => t.seen('message', (d) => d.body === 'sent while you were cut off'), 10000)))
  const got = await t.peer(you, [{ wait_for: 'written while cut off', timeout: 10 }])
  t.check('what it wrote meanwhile is sent once it is back', got.received.includes('written while cut off'), got.received.slice(-300))
  if (ejabberd) {
    const resumeLine = linesOf(new RegExp(`xmpp\\[${myId}\\]: signed in with`)).pop() ?? ''
    t.check('the reconnection signed in with the token, not the password, and did not bind (so the old session could be resumed)', /HT-SHA-256-(EXPR|ENDP) over SASL2$/.test(resumeLine.trim()), resumeLine)
  }

  if (ejabberd) {
    console.log('a session the server has forgotten')
    const resetsBefore = linesOf(new RegExp(`xmpp\\[${myId}\\]: signed in as`)).length
    r.silence(true)
    const res = /resource = "([^"]+)"/.exec(t.accountsToml())?.[1] ?? resource
    ctl('kick_session', me.name, 'localhost', res, 'probe')
    r.silence(false)
    r.cut()
    await t.peer(you, [{ raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='s-2'><body>sent while the session was gone</body><store xmlns='urn:xmpp:hints'/></message>` }, { sleep: 0.5 }])
    t.check('a session that cannot be resumed is begun afresh', !!(await t.until(async () => linesOf(new RegExp(`xmpp\\[${myId}\\]: signed in as`)).length > resetsBefore, 30000)), linesOf(/xmpp\[/).slice(-8).join('\n'))
    t.check('and what was said meanwhile is caught up', !!(await t.until(async () => t.seen('message', (d) => d.body === 'sent while the session was gone'), 15000)))
  }

  console.log('a half-open connection (traffic stops, nothing closes)')
  const dropsBefore = linesOf(new RegExp(`xmpp\\[${myId}\\]: the connection dropped`)).length
  const silentAt = Date.now()
  r.silence(true)
  const noticed = await t.until(async () => linesOf(new RegExp(`xmpp\\[${myId}\\]: the connection dropped`)).length > dropsBefore, 90000)
  const took = Math.round((Date.now() - silentAt) / 1000)
  r.silence(false)
  t.check(`is noticed within a minute (took ${took} s)`, !!noticed && took <= 60, `${took} s`)
  r.cut()
  t.check('and the account comes back', !!(await t.until(async () => (await t.state(me)) === 'connected', 30000)))

  console.log('another device takes this resource')
  const now = /resource = "([^"]+)"/.exec(t.accountsToml())?.[1]
  const other = path.join(t.scratch, 'conflict.txt')
  fs.writeFileSync(other, `${me.jid}/${now} ${me.password}\n`, { mode: 0o600 })
  await run('/1tb/xmpp-test/venv/bin/python', [path.join(root, 'scripts/lib/xmpp-peer.py'), me.name, JSON.stringify([{ sleep: 2 }])], { env: { ...process.env, XMPP_TEST_ACCOUNTS: other, XMPP_TEST_PORT: String(PORT) } }).catch(() => null)
  const said = await t.until(async () => t.events.find((e) => e.event === 'connectionState' && e.data?.accountId === myId && /Another device signed in with the same resource/.test(`${e.data?.error ?? ''} ${e.data?.detail ?? ''}`)), 10000)
  t.check('the account says so in words', !!said)
  t.check('and comes back', !!(await t.until(async () => (await t.state(me)) === 'connected', 30000)))
  if (!ejabberd) {
    const after = /resource = "([^"]+)"/.exec(t.accountsToml())?.[1]
    t.check('with a resource of its own, so the two do not take it from each other in turn', after && after !== now, `${now} -> ${after}`)
  }

  console.log('see-other-host')
  const redirect = fakeServer(5297, 'see-other-host', `127.0.0.1:${DIRECT}`)
  await redirect.ready()
  await t.rpc('addXmppAccount', { jid: you.jid, password: you.password, host: '127.0.0.1', port: 5297, security: 'direct', caPem: ca })
  t.check('the account goes where the server sent it and signs in', !!(await t.until(async () => (await t.state(you)) === 'connected', 20000)), await t.state(you))
  t.check('after one visit to the first server', redirect.served() === 1, redirect.served())
  redirect.kill()

  console.log('system-shutdown')
  const shutdown = fakeServer(5296, 'system-shutdown')
  await shutdown.ready()
  await t.rpc('addXmppAccount', { jid: third.jid, password: third.password, host: '127.0.0.1', port: 5296, security: 'direct', caPem: ca })
  const down = await t.until(async () => t.events.find((e) => e.event === 'connectionState' && e.data?.accountId === t.accountId(third) && /shutting down/.test(e.data?.detail ?? '') && e.data?.retryAt), 15000)
  t.check('is said in words, with when it will be tried again', !!down, JSON.stringify(t.events.filter((e) => e.data?.accountId === t.accountId(third)).slice(-3)))
  t.check('and tried again, not given up', (await t.state(third)) === 'connecting')
  await t.rpc('removeAccount', { accountId: t.accountId(third) })
  shutdown.kill()

  if (ejabberd) {
    console.log('a token the server no longer takes')
    await t.rpc('removeAccount', { accountId: t.accountId(you) })
    await t.restart((text) => text.replace(/fast_token = "[^"]+"/, 'fast_token = "not-a-token-the-server-gave"'))
    t.check('the account signs in anyway', !!(await t.until(async () => (await t.state(me)) === 'connected', 20000)), await t.state(me))
    const lines = linesOf(new RegExp(`xmpp\\[(${me.jid}|${myId})\\]`)).slice(-12).join('\n')
    t.check('the token was refused and the password used', /refused the sign-in token/.test(lines) && /signed in with SCRAM-SHA-512-PLUS/.test(lines), lines)
    const kept = t.accountsToml()
    t.check('and a new token replaced the bad one', /fast_token = "[^"]+"/.test(kept) && !kept.includes('not-a-token-the-server-gave'))
  }
} catch (err) {
  t.failed(err)
} finally {
  r.close()
  await t.finish()
}
