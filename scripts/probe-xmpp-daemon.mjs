#!/usr/bin/env node
/**
 * The daemon against the local XMPP test server, with no window: what an XMPP account does when it connects, and what it
 * does when it must not.
 *
 *   ~/.local/share/moho-dev/xmpp-test.sh up
 *   (cd nobilis && cargo build --release)
 *   node scripts/probe-xmpp-daemon.mjs
 *
 * It starts its own daemon in a scratch HOME and XDG_RUNTIME_DIR - never the live one: quitting a daemon that a real
 * window shares takes the window's connection with it - and kills it before it exits. The accounts it signs in as are
 * the test server's (`/1tb/xmpp-test/accounts.txt`, one `jid password` per line); the certificate authority that signed
 * the server's certificate is `/1tb/xmpp-test/pki/ca.pem`.
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { root, sleep } from './lib/harness.mjs'

const accountsFile = process.env.XMPP_TEST_ACCOUNTS ?? '/1tb/xmpp-test/accounts.txt'
const caFile = process.env.XMPP_TEST_CA ?? '/1tb/xmpp-test/pki/ca.pem'
const host = process.env.XMPP_TEST_HOST ?? '127.0.0.1'
const people = Object.fromEntries(
  fs
    .readFileSync(accountsFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split(' '))
    .map(([jid, password]) => [jid.split('@')[0], { jid, password }])
)
const ca = fs.readFileSync(caFile, 'utf8')

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'moho-xmpp-probe-'))
const run = path.join(scratch, 'run')
fs.mkdirSync(run, { recursive: true, mode: 0o700 })
const env = {
  ...process.env,
  HOME: scratch,
  XDG_CONFIG_HOME: path.join(scratch, 'config'),
  XDG_DATA_HOME: path.join(scratch, 'data'),
  XDG_CACHE_HOME: path.join(scratch, 'cache'),
  XDG_RUNTIME_DIR: run
}
const daemon = spawn(path.join(root, 'nobilis/target/release/nobilis'), [], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
daemon.stdout.on('data', (d) => (log += d))
daemon.stderr.on('data', (d) => (log += d))
const stopDaemon = () => {
  try {
    daemon.kill('SIGKILL')
  } catch {
    /* gone */
  }
  fs.rmSync(scratch, { recursive: true, force: true })
}
process.on('exit', stopDaemon)

const sock = path.join(run, 'nobilis', 'nobilis.sock')
for (let i = 0; i < 100 && !fs.existsSync(sock); i++) await sleep(100)
if (!fs.existsSync(sock)) {
  console.log(log)
  throw new Error('the daemon did not open its socket')
}
const conn = net.connect(sock)
let buf = ''
let nextId = 1
const waiting = new Map()
const events = []
conn.on('data', (d) => {
  buf += d
  const lines = buf.split('\n')
  buf = lines.pop()
  for (const line of lines) {
    const m = JSON.parse(line)
    if (m.id && waiting.has(m.id)) {
      waiting.get(m.id)(m)
      waiting.delete(m.id)
    } else if (m.event) events.push(m)
  }
})
const rpc = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    waiting.set(id, (m) => (m.error ? reject(new Error(m.error)) : resolve(m.result)))
    conn.write(JSON.stringify({ id, method, params }) + '\n')
  })
const results = []
const check = (what, ok, detail = '') => {
  results.push(ok)
  console.log(ok ? '  ok  ' : '  FAIL', what, detail)
}
const account = async (id) => (await rpc('listAccounts')).find((a) => a.id === id)
const until = async (what, fn, ms = 20000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    const v = await fn()
    if (v) return v
    await sleep(150)
  }
  return null
}
const stateOf = async (id) => (await account(id))?.state
const errorOf = (id) => events.filter((e) => e.event === 'connectionState' && e.data?.accountId === id).map((e) => e.data?.error).filter(Boolean).pop() ?? ''

try {
  const alice = people.alice
  const id = `xmpp:${alice.jid}`

  console.log('trusting the server by its authority')
  let r = await rpc('addXmppAccount', { jid: alice.jid, password: alice.password, host, caPem: ca })
  check('the account is made', r.accountId === id, JSON.stringify(r))
  check('it signs in (STARTTLS, SCRAM)', (await until('connected', async () => (await stateOf(id)) === 'connected')) !== null, await stateOf(id))
  const listed = await account(id)
  check('it is listed as an XMPP account', listed?.service === 'xmpp' && listed?.displayName === alice.jid, JSON.stringify(listed)?.slice(0, 160))
  const cfg = fs.readFileSync(path.join(scratch, 'config', 'nobilis', 'accounts.toml'), 'utf8')
  const resource = /resource = "(moho[^"]+)"/.exec(cfg)?.[1]
  check('it made a resource and kept it', !!resource, resource ?? cfg.slice(0, 200))

  console.log('disconnect and connect again')
  await rpc('setAccountConnected', { accountId: id, connected: false })
  check('it disconnects', (await until('dc', async () => (await stateOf(id)) === 'disconnected')) !== null, await stateOf(id))
  await rpc('setAccountConnected', { accountId: id, connected: true })
  check('it connects again', (await until('c', async () => (await stateOf(id)) === 'connected')) !== null, await stateOf(id))
  const cfg2 = fs.readFileSync(path.join(scratch, 'config', 'nobilis', 'accounts.toml'), 'utf8')
  check('with the same resource', cfg2.includes(`resource = "${resource}"`))

  console.log('a server nobody told it to trust')
  await rpc('removeAccount', { accountId: id })
  const bob = people.bob
  const bobId = `xmpp:${bob.jid}`
  await rpc('addXmppAccount', { jid: bob.jid, password: bob.password, host })
  const refused = await until('refused', async () => (await stateOf(bobId)) === 'auth_failed', 20000)
  check('its certificate is refused, and it stops', refused !== null, await stateOf(bobId))
  const why = errorOf(bobId)
  check('and says what the server showed', /certificate/i.test(why) && /[0-9a-f]{64}/.test(why), why)
  const fingerprint = /[0-9a-f]{64}/.exec(why)?.[0]

  console.log('looking at the certificate and trusting it')
  const shown = await rpc('getXmppCertificate', { accountId: bobId })
  check('the window can ask what the server showed', shown.sha256 === fingerprint && /UnknownIssuer/.test(shown.refused ?? ''), JSON.stringify(shown))
  let wrong = ''
  try {
    await rpc('trustXmppCertificate', { accountId: bobId, sha256: 'ab'.repeat(32) })
  } catch (err) {
    wrong = String(err.message)
  }
  check('a fingerprint the server did not show is not trusted', /not the certificate/.test(wrong), wrong)
  check('and the account is still stopped', (await stateOf(bobId)) === 'auth_failed', await stateOf(bobId))
  await rpc('trustXmppCertificate', { accountId: bobId, sha256: fingerprint.toUpperCase().match(/.{2}/g).join(':') })
  check('the one it showed is, and the account connects', (await until('trusted', async () => (await stateOf(bobId)) === 'connected')) !== null, await stateOf(bobId))
  check('the pin is kept with the account', fs.readFileSync(path.join(scratch, 'config', 'nobilis', 'accounts.toml'), 'utf8').includes(`pin_sha256 = "${fingerprint}"`))

  console.log('the same server by a fingerprint given when the account is made')
  await rpc('removeAccount', { accountId: bobId })
  await rpc('addXmppAccount', { jid: bob.jid, password: bob.password, host, pinSha256: fingerprint })
  check('a pinned certificate is trusted', (await until('pinned', async () => (await stateOf(bobId)) === 'connected')) !== null, await stateOf(bobId))
  await rpc('removeAccount', { accountId: bobId })

  console.log('direct TLS')
  await rpc('addXmppAccount', { jid: bob.jid, password: bob.password, host, security: 'direct', caPem: ca })
  check('TLS from the first byte works too', (await until('direct', async () => (await stateOf(bobId)) === 'connected')) !== null, await stateOf(bobId))
  await rpc('removeAccount', { accountId: bobId })

  console.log('a wrong password')
  const carol = people.carol
  const carolId = `xmpp:${carol.jid}`
  await rpc('addXmppAccount', { jid: carol.jid, password: carol.password + 'x', host, caPem: ca })
  const bad = await until('bad', async () => (await stateOf(carolId)) === 'auth_failed', 20000)
  check('the server refuses it and the account stops', bad !== null, await stateOf(carolId))
  const why2 = errorOf(carolId)
  check('in words', /password/i.test(why2), why2)
  const attempts = (log.match(/xmpp\[xmpp:carol@localhost\]: stopped/g) ?? []).length
  check('after one try, not a loop', attempts === 1, `${attempts}`)
  await rpc('setXmppPassword', { accountId: carolId, password: carol.password })
  check('a corrected password signs it in', (await until('fixed', async () => (await stateOf(carolId)) === 'connected')) !== null, await stateOf(carolId))
  await rpc('removeAccount', { accountId: carolId })

  console.log('an address that is not one')
  let e = ''
  try {
    await rpc('addXmppAccount', { jid: 'not an address', password: 'x' })
  } catch (err) {
    e = String(err.message)
  }
  check('is refused up front', /not an XMPP address|no user part/.test(e), e)
} catch (err) {
  console.log('  FAIL', err.message)
  results.push(false)
} finally {
  stopDaemon()
}
await sleep(200)
let left = ''
try {
  left = execFileSync('pgrep', ['-af', scratch]).toString()
} catch {
  /* none */
}
check('no daemon left behind', left.trim() === '', left)
const ok = results.every(Boolean)
if (process.env.XMPP_PROBE_LOG) console.log(log)
console.log(ok ? 'ALL OK' : 'FAILED')
process.exit(ok ? 0 : 1)
