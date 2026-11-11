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
export const ctl = (...args) => execFileSync(path.join(os.homedir(), '.local/share/moho-dev/xmpp-test.sh'), ['ctl', ...args]).toString()
export const ca = fs.readFileSync(process.env.XMPP_TEST_CA ?? '/1tb/xmpp-test/pki/ca.pem', 'utf8')
const python = process.env.XMPP_PEER_PYTHON ?? '/1tb/xmpp-test/venv/bin/python'

export async function start({ people = 2 } = {}) {
  const stamp = Date.now().toString(36)
  const accounts = Array.from({ length: people }, (_, i) => ({ name: `p${'abcd'[i]}${stamp}`, password: `pw-${stamp}-${i}`, jid: `p${'abcd'[i]}${stamp}@localhost` }))
  for (const p of accounts) ctl('register', p.name, 'localhost', p.password)
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'moho-xmpp-probe-'))
  const accountsFile = path.join(scratch, 'accounts.txt')
  fs.writeFileSync(accountsFile, accounts.map((p) => `${p.jid} ${p.password}`).join('\n') + '\n', { mode: 0o600 })
  const runtime = path.join(scratch, 'run')
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 })
  const env = { ...process.env, HOME: scratch, XDG_CONFIG_HOME: path.join(scratch, 'config'), XDG_DATA_HOME: path.join(scratch, 'data'), XDG_CACHE_HOME: path.join(scratch, 'cache'), XDG_RUNTIME_DIR: runtime }
  const daemon = spawn(path.join(root, 'nobilis/target/release/nobilis'), [], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const probe = { accounts, scratch, stamp, log: '', events: [], results: [] }
  daemon.stdout.on('data', (d) => (probe.log += d))
  daemon.stderr.on('data', (d) => (probe.log += d))
  probe.cleanup = () => {
    try {
      daemon.kill('SIGKILL')
    } catch {
      /* gone */
    }
    for (const p of accounts) {
      try {
        ctl('unregister', p.name, 'localhost')
      } catch {
        /* already gone */
      }
    }
    fs.rmSync(scratch, { recursive: true, force: true })
  }
  process.on('exit', probe.cleanup)
  const sock = path.join(runtime, 'nobilis', 'nobilis.sock')
  for (let i = 0; i < 100 && !fs.existsSync(sock); i++) await sleep(100)
  if (!fs.existsSync(sock)) throw new Error('the daemon did not open its socket\n' + probe.log)
  const conn = net.connect(sock)
  let buf = ''
  let nextId = 1
  const waiting = new Map()
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
  probe.rpc = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      waiting.set(id, (m) => (m.error ? reject(new Error(m.error)) : resolve(m.result)))
      conn.write(JSON.stringify({ id, method, params }) + '\n')
    })
  probe.peer = async (who, steps) => {
    const { stdout } = await run(python, [path.join(root, 'scripts/lib/xmpp-peer.py'), who.name, JSON.stringify(steps)], { env: { ...process.env, XMPP_TEST_ACCOUNTS: accountsFile }, maxBuffer: 1 << 24 })
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
    await probe.rpc('addXmppAccount', { jid: p.jid, password: p.password, host: '127.0.0.1', caPem: ca })
    return probe.until(async () => (await probe.state(p)) === 'connected')
  }
  probe.finish = async () => {
    if (!probe.results.every(Boolean) || process.env.XMPP_PROBE_LOG) console.log(probe.log.split('\n').filter((l) => /xmpp|WARN|ERROR/.test(l)).slice(-80).map((l) => l.slice(0, 260)).join('\n'))
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
