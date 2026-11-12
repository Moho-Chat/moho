/**
 * What the XMPP probes share: a scratch daemon (its own HOME and XDG_RUNTIME_DIR, never the live one), two fresh accounts
 * on the test server for the run (removed after), a way to talk to the daemon, and a second client (slixmpp) to be the
 * other person.
 */
import { spawn, execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { root, sleep } from './harness.mjs'

const run = promisify(execFile)
export { sleep }
export const SERVER = process.env.XMPP_TEST_SERVER ?? 'ejabberd'
export const DOMAIN = SERVER === 'prosody' ? 'xmpp2.localhost' : 'localhost'
export const PORT = SERVER === 'prosody' ? 5232 : 5222
export const CONF = `conference.${DOMAIN}`
export const ctl = (...args) => execFileSync(path.join(os.homedir(), '.local/share/moho-dev/xmpp-test.sh'), ['ctl', ...args]).toString()
const prosodyctl = (...args) => execFileSync('docker', ['-H', 'unix:///run/docker-xmpp.sock', 'exec', 'prosody', 'prosodyctl', ...args]).toString()
/** Making and removing accounts on whichever server the run is against. */
export const registerUser = (name, password) => (SERVER === 'prosody' ? prosodyctl('register', name, DOMAIN, password) : ctl('register', name, DOMAIN, password))
export const unregisterUser = (name) => (SERVER === 'prosody' ? prosodyctl('deluser', `${name}@${DOMAIN}`) : ctl('unregister', name, DOMAIN))
export const userRegistered = (name) => {
  if (SERVER === 'prosody') {
    try {
      return prosodyctl('mod_auth_internal_hashed', 'x') && false
    } catch {
      /* fall through */
    }
    return fs.existsSync(`/1tb/xmpp-test/prosody/data/${encodeURIComponent(DOMAIN).replace(/\./g, '%2e')}/accounts/${name}.dat`)
  }
  return ctl('registered_users', DOMAIN).split('\n').includes(name)
}
export const passwordWorks = (name, password) => {
  if (SERVER === 'prosody') return false
  try {
    ctl('check_password', name, DOMAIN, password)
    return true
  } catch {
    return false
  }
}
export const ca = fs.readFileSync(process.env.XMPP_TEST_CA ?? '/1tb/xmpp-test/pki/ca.pem', 'utf8')
const python = process.env.XMPP_PEER_PYTHON ?? '/1tb/xmpp-test/venv/bin/python'

/**
 * `resolver`: an address the daemon asks DNS of instead of the system's (the test DNS of `xmpp-test.sh dns`). The daemon then runs
 * in a mount namespace of its own (`unshare -Urm`, no privileges needed) with its own resolv.conf and nsswitch.conf.
 */
// `home`: files to put in the scratch HOME before the daemon starts, by path relative to it (`.asoundrc`, say).
export async function start({ people = 2, resolver = null, home = {} } = {}) {
  const stamp = Date.now().toString(36)
  const accounts = Array.from({ length: people }, (_, i) => ({ name: `p${'abcd'[i]}${stamp}`, password: `pw-${stamp}-${i}`, jid: `p${'abcd'[i]}${stamp}@${DOMAIN}` }))
  for (const p of accounts) registerUser(p.name, p.password)
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'moho-xmpp-probe-'))
  const accountsFile = path.join(scratch, 'accounts.txt')
  fs.writeFileSync(accountsFile, accounts.map((p) => `${p.jid} ${p.password}`).join('\n') + '\n', { mode: 0o600 })
  for (const [rel, content] of Object.entries(home)) {
    fs.mkdirSync(path.dirname(path.join(scratch, rel)), { recursive: true })
    fs.writeFileSync(path.join(scratch, rel), content)
  }
  const runtime = path.join(scratch, 'run')
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 })
  const env = { ...process.env, HOME: scratch, XDG_CONFIG_HOME: path.join(scratch, 'config'), XDG_DATA_HOME: path.join(scratch, 'data'), XDG_CACHE_HOME: path.join(scratch, 'cache'), XDG_RUNTIME_DIR: runtime }
  const probe = { accounts, scratch, stamp, log: '', events: [], results: [] }
  let daemon = null
  let conn = null
  let nextId = 1
  const waiting = new Map()
  const sock = path.join(runtime, 'nobilis', 'nobilis.sock')
  // The daemon and the socket to it: made here, and again by restart().
  const launch = async () => {
    const binary = path.join(root, 'nobilis/target/release/nobilis')
    if (resolver) {
      const conf = path.join(scratch, 'resolv.conf')
      const nss = path.join(scratch, 'nsswitch.conf')
      fs.writeFileSync(conf, `nameserver ${resolver}\noptions timeout:1 attempts:1\n`)
      fs.writeFileSync(nss, fs.readFileSync('/etc/nsswitch.conf', 'utf8').replace(/^hosts:.*$/m, 'hosts: files dns'))
      daemon = spawn('unshare', ['-Urm', 'sh', '-c', 'mount --bind "$0" /etc/resolv.conf && mount --bind "$1" /etc/nsswitch.conf && exec "$2"', conf, nss, binary], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    } else {
      daemon = spawn(binary, [], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    }
    daemon.stdout.on('data', (d) => (probe.log += d))
    daemon.stderr.on('data', (d) => (probe.log += d))
    for (let i = 0; i < 100 && !fs.existsSync(sock); i++) await sleep(100)
    if (!fs.existsSync(sock)) throw new Error('the daemon did not open its socket\n' + probe.log)
    conn = net.connect(sock)
    let buf = ''
    conn.on('data', (d) => {
      buf += d
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const line of lines) {
        const m = JSON.parse(line)
        if (m.id && waiting.has(m.id)) {
          waiting.get(m.id)(m)
          waiting.delete(m.id)
        } else if (m.event) probe.events.push(m)
      }
    })
  }
  probe.cleanup = () => {
    try {
      daemon?.kill('SIGKILL')
    } catch {
      /* gone */
    }
    for (const p of accounts) {
      try {
        unregisterUser(p.name)
      } catch {
        /* already gone */
      }
    }
    fs.rmSync(scratch, { recursive: true, force: true })
  }
  process.on('exit', probe.cleanup)
  await launch()
  probe.rpc = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      waiting.set(id, (m) => (m.error ? reject(new Error(m.error)) : resolve(m.result)))
      conn.write(JSON.stringify({ id, method, params }) + '\n')
    })
  /** The account file, as the daemon wrote it. */
  probe.accountsToml = () => fs.readFileSync(path.join(scratch, 'config', 'nobilis', 'accounts.toml'), 'utf8')
  /** Stops the daemon, lets `edit` change its account file (text in, text out), and starts it again on the same files. */
  probe.restart = async (edit = (t) => t) => {
    conn.destroy()
    const gone = new Promise((r) => daemon.once('exit', r))
    daemon.kill('SIGTERM')
    await Promise.race([gone, sleep(5000)])
    try {
      daemon.kill('SIGKILL')
    } catch {
      /* gone */
    }
    const file = path.join(scratch, 'config', 'nobilis', 'accounts.toml')
    fs.writeFileSync(file, edit(fs.readFileSync(file, 'utf8')))
    fs.rmSync(sock, { force: true })
    await launch()
  }
  /** Another client (slixmpp) doing `steps`; `env` adds to its environment (XMPP_PEER_FEATURES: what it says it can do). */
  probe.peer = async (who, steps, env = {}) => {
    const { stdout } = await run(python, [path.join(root, 'scripts/lib/xmpp-peer.py'), who.name, JSON.stringify(steps)], { env: { ...process.env, XMPP_TEST_ACCOUNTS: accountsFile, XMPP_TEST_PORT: String(PORT), ...env }, maxBuffer: 1 << 24 })
    return JSON.parse(stdout)
  }
  probe.check = (what, ok, detail = '') => {
    probe.results.push(!!ok)
    console.log(ok ? '  ok  ' : '  FAIL', what, ok ? '' : String(detail).slice(0, 500))
  }
  probe.until = async (fn, ms = 15000) => {
    const t = Date.now()
    while (Date.now() - t < ms) {
      const v = await fn()
      if (v) return v
      await sleep(120)
    }
    return null
  }
  probe.seen = (event, pred = () => true) => probe.events.find((e) => e.event === event && pred(e.data))?.data
  probe.accountId = (p) => `xmpp:${p.jid}`
  probe.state = async (p) => (await probe.rpc('listAccounts')).find((a) => a.id === probe.accountId(p))?.state
  probe.signIn = async (p) => {
    await probe.rpc('addXmppAccount', { jid: p.jid, password: p.password, host: '127.0.0.1', port: PORT, caPem: ca })
    return probe.until(async () => (await probe.state(p)) === 'connected')
  }
  probe.finish = async () => {
    if (!probe.results.every(Boolean) || process.env.XMPP_PROBE_LOG) console.log(probe.log.split('\n').filter((l) => /xmpp|WARN|ERROR/.test(l)).slice(process.env.XMPP_PROBE_LOG ? -1500 : -80).map((l) => l.slice(0, 400)).join('\n'))
    probe.cleanup()
    await sleep(200)
    const ok = probe.results.every(Boolean)
    console.log(ok ? 'ALL OK' : 'FAILED')
    process.exit(ok ? 0 : 1)
  }
  probe.failed = (err) => {
    console.log('  FAIL', err.message)
    probe.results.push(false)
    console.log(probe.log.split('\n').filter((l) => /xmpp|WARN|ERROR/.test(l)).slice(-30).map((l) => l.slice(0, 300)).join('\n'))
  }
  return probe
}
