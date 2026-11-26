/**
 * The daemon's web helper.
 *
 * Some sites sit behind a gate that admits browsers and nothing else - Kiwi
 * Farms' Tartarus is one - and decides which is which by how a connection
 * looks on the wire, not by anything a client says about itself. The cookie
 * such a gate hands out is only honoured from the network stack that earned
 * it. So nobilis, whose protocols live in Rust, borrows Chromium's: it starts
 * this process (moho's own binary with `--moho-web-helper`) and asks it, over
 * stdin and stdout, to make requests and hold websockets for it.
 *
 * The helper knows nothing about any chat. Each line in is one instruction,
 * each line out one answer or event, JSON both ways:
 *
 *   request    method, url, headers, body (base64)  -> status, headers, body
 *              Cookies are whatever the caller puts in the headers: the
 *              daemon keeps the jar, as it does for every other request.
 *   clearGate  url, cookies  -> the cookies after a hidden page has
 *              loaded the url and the site's own gate script has run in it.
 *   wsOpen     url, protocols, page, cookies -> a socket id, then
 *              open / message / close events for it. The socket is opened
 *              from a hidden page on `page`, so it carries that origin.
 *   wsSend, wsClose
 *
 * Every instruction may name a proxy (`socks5://host:port`), for an account
 * that goes through Tor or a proxy of its own.
 *
 * Nothing persists: the profile is a temporary directory removed on exit, and
 * every gate page and socket gets a cookie jar of its own. The helper quits
 * when its stdin closes, so it cannot outlive the daemon that started it.
 */
import { app, BrowserWindow, net, session, type Session } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

/**
 * The user agent everything goes out with: Chromium's own, without Electron's
 * or moho's names in it. Always this one, whatever the caller asked for - a
 * gate that compares what a client says it is with what its connection looks
 * like should find the two agree.
 */
let UA = ''

type Cookie = { name: string; value: string; path?: string; domain?: string; httpOnly?: boolean }
type Msg = Record<string, any>

const PROFILE_PREFIX = 'moho-web-helper-'
const OWNER_FILE = 'owner.pid'
const profile = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX))
fs.writeFileSync(path.join(profile, OWNER_FILE), String(process.pid))
app.setPath('userData', profile)
sweepOrphanedProfiles()

/**
 * Removes profiles that earlier helpers left behind.
 *
 * Each helper deletes its own on the way out, and on Windows that fails: the
 * GPU, network and renderer processes still hold files in it at that moment,
 * and they outlive the code that is deleting. One folder stayed in %TEMP% per
 * helper started. So the next helper clears them instead, once their owners
 * are gone. A folder whose owner is still running belongs to another daemon's
 * helper (a second moho, a test window) and is left alone; one from before
 * owners were written down is cleared once it is a day old.
 */
function sweepOrphanedProfiles(): void {
  const tmp = os.tmpdir()
  let names: string[]
  try {
    names = fs.readdirSync(tmp).filter((n) => n.startsWith(PROFILE_PREFIX))
  } catch {
    return
  }
  for (const name of names) {
    const dir = path.join(tmp, name)
    if (dir === profile || !orphaned(dir)) continue
    fs.rm(dir, { recursive: true, force: true, maxRetries: 2 }, () => {})
  }
}

function orphaned(dir: string): boolean {
  try {
    const pid = Number(fs.readFileSync(path.join(dir, OWNER_FILE), 'utf8'))
    if (!Number.isInteger(pid) || pid <= 0) return true
    try {
      process.kill(pid, 0)
      return false
    } catch (e) {
      // EPERM: alive, and somebody else's.
      return (e as NodeJS.ErrnoException).code === 'ESRCH'
    }
  } catch {
    try {
      return Date.now() - fs.statSync(dir).mtimeMs > 24 * 60 * 60 * 1000
    } catch {
      return false
    }
  }
}
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {
  // A helper with no page open is still a helper.
})
app.dock?.hide()

function out(msg: Msg): void {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function quit(): void {
  try {
    fs.rmSync(profile, { recursive: true, force: true })
  } catch {
    // A temp directory the system will clear anyway.
  }
  app.exit(0)
}

/** Headers Chromium sets itself and refuses from a caller. */
const OWN_HEADERS = new Set(['host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'expect', 'cookie2'])

let partitions = 0
const proxied = new Map<string, Session>()

async function withProxy(ses: Session, proxy: string | null | undefined): Promise<Session> {
  await ses.setProxy(proxy ? { proxyRules: proxy, proxyBypassRules: '<-loopback>' } : { mode: 'direct' })
  return ses
}

/** A session for plain requests: one per route, its own jar unused. */
async function requestSession(proxy: string | null | undefined): Promise<Session> {
  const key = proxy ?? 'direct'
  let ses = proxied.get(key)
  if (!ses) {
    ses = await withProxy(session.fromPartition(`request:${++partitions}`), proxy)
    proxied.set(key, ses)
  }
  return ses
}

/** A throwaway session holding `cookies` for `url`'s site. */
async function cookieSession(url: string, cookies: Cookie[], proxy: string | null | undefined): Promise<Session> {
  const ses = await withProxy(session.fromPartition(`page:${++partitions}`), proxy)
  ses.setUserAgent(UA)
  const origin = new URL(url).origin
  const seeded = new Map<string, string>()
  for (const c of cookies) {
    const at = origin + (c.path || '/')
    await ses.cookies
      .set({ url: at, name: c.name, value: c.value, path: c.path || '/', secure: origin.startsWith('https:'), httpOnly: c.httpOnly ?? true })
      .then(() => seeded.set(c.name, at))
      .catch(() => {})
  }
  giveWayToSite(ses, seeded)
  return ses
}

/**
 * Makes the site's own Set-Cookie replace a cookie the caller seeded.
 *
 * The caller's cookies go in host-only, as they have no other scope to give.
 * A site that sets the same name for its whole domain makes a second cookie
 * rather than overwriting the first, and both then go out with the seeded -
 * older - one first. Tartarus began doing that on 2026-11-25: a saved
 * clearance that had lapsed kept being sent ahead of every fresh one, and the
 * gate page solved, passed, reloaded and was challenged again until the
 * daemon gave up. So the first time the site sets a cookie the caller seeded,
 * the seeded copy is removed before the response's cookies are stored.
 */
function giveWayToSite(ses: Session, seeded: Map<string, string>): void {
  if (seeded.size === 0) return
  ses.webRequest.onHeadersReceived(async (details, callback) => {
    for (const [key, values] of Object.entries(details.responseHeaders || {})) {
      if (key.toLowerCase() !== 'set-cookie') continue
      for (const line of values) {
        const name = line.split('=', 1)[0].trim()
        const at = seeded.get(name)
        if (at === undefined) continue
        seeded.delete(name)
        await ses.cookies.remove(at, name).catch(() => {})
      }
    }
    callback({})
  })
}

async function forget(ses: Session): Promise<void> {
  await ses.clearStorageData().catch(() => {})
  await ses.clearCache().catch(() => {})
}

function request(msg: Msg): Promise<Msg> {
  return requestSession(msg.proxy).then(
    (ses) =>
      new Promise((resolve) => {
        const req = net.request({ url: msg.url, method: msg.method || 'GET', session: ses, useSessionCookies: false, redirect: 'manual' })
        for (const [k, v] of (msg.headers as [string, string][]) || []) {
          if (!OWN_HEADERS.has(k.toLowerCase()) && k.toLowerCase() !== 'user-agent') req.setHeader(k, v)
        }
        req.setHeader('User-Agent', UA)
        const chunks: Buffer[] = []
        // How far the body has gone, said as it goes: only for a request that
        // asked, which is an upload somebody is watching.
        let poll: ReturnType<typeof setInterval> | null = null
        const stopPolling = (): void => {
          if (poll) clearInterval(poll)
          poll = null
        }
        const timer = setTimeout(() => {
          stopPolling()
          req.abort()
          resolve({ ok: false, error: 'timed out' })
        }, msg.timeoutMs || 60_000)
        const answer = (status: number, headers: Record<string, string | string[]>): void => {
          stopPolling()
          const flat: [string, string][] = []
          for (const [k, v] of Object.entries(headers)) for (const one of Array.isArray(v) ? v : [v]) flat.push([k, one])
          resolve({ ok: true, status, headers: flat, body: Buffer.concat(chunks).toString('base64') })
        }
        req.on('redirect', (status, _method, location, headers) => {
          clearTimeout(timer)
          req.abort()
          const h = { ...(headers as Record<string, string | string[]>) }
          if (!Object.keys(h).some((k) => k.toLowerCase() === 'location')) h.location = location
          answer(status, h)
        })
        req.on('response', (res) => {
          res.on('data', (d: Buffer) => chunks.push(Buffer.from(d)))
          res.on('end', () => {
            clearTimeout(timer)
            answer(res.statusCode, res.headers as Record<string, string | string[]>)
          })
          res.on('error', () => {
            clearTimeout(timer)
            resolve({ ok: false, error: 'the response broke off' })
          })
        })
        req.on('error', (e) => {
          clearTimeout(timer)
          stopPolling()
          resolve({ ok: false, error: e.message })
        })
        if (msg.body) req.write(Buffer.from(msg.body, 'base64'))
        req.end()
        if (msg.progress) {
          poll = setInterval(() => {
            const p = req.getUploadProgress()
            if (p.started) out({ event: 'upload', req: msg.id, current: p.current, total: p.total })
          }, 250)
        }
      })
  )
}

/** Whether the page in `win` is a gate's challenge rather than the site. */
async function gated(win: BrowserWindow): Promise<boolean> {
  return win.webContents
    .executeJavaScript(`document.readyState !== 'complete' || !!document.getElementById('ttrs')`)
    .catch(() => true)
}

async function clearGate(msg: Msg): Promise<Msg> {
  const ses = await cookieSession(msg.url, msg.cookies || [], msg.proxy)
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true, offscreen: true } })
  const started = Date.now()
  try {
    await win.loadURL(msg.url).catch(() => {})
    const deadline = started + (msg.timeoutMs || 90_000)
    while (await gated(win)) {
      if (Date.now() > deadline) return { ok: false, error: 'the gate did not let the page through in time' }
      await new Promise((r) => setTimeout(r, 750))
    }
    const cookies = (await ses.cookies.get({ url: msg.url })).map((c) => ({ name: c.name, value: c.value, path: c.path, domain: c.domain, httpOnly: c.httpOnly }))
    return { ok: true, cookies, seconds: (Date.now() - started) / 1000 }
  } finally {
    win.destroy()
    void forget(ses)
  }
}

type Socket = { win: BrowserWindow; ses: Session }
const sockets = new Map<number, Socket>()
let socketIds = 0

async function wsOpen(msg: Msg): Promise<Msg> {
  const id = ++socketIds
  const page: string = msg.page
  const ses = await cookieSession(page, msg.cookies || [], msg.proxy)
  const win = new BrowserWindow({
    show: false,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, offscreen: true, preload: path.join(__dirname, '../preload/webhelper.js') }
  })
  sockets.set(id, { win, ses })
  win.webContents.ipc.on('ws-event', (_e, sid: number, event: string, a: unknown, b: unknown) => {
    if (event === 'open') out({ ws: sid, event, protocol: a })
    else if (event === 'message') out({ ws: sid, event, data: a })
    else if (event === 'close') {
      out({ ws: sid, event, code: a, reason: b })
      close(sid)
    }
  })
  win.webContents.on('render-process-gone', () => {
    if (sockets.has(id)) out({ ws: id, event: 'close', code: 1006, reason: 'the helper page went away' })
    close(id)
  })
  try {
    await win.loadURL(page)
  } catch (e) {
    close(id)
    return { ok: false, error: `opening ${page}: ${(e as Error).message}` }
  }
  if (await gated(win)) {
    close(id)
    return { ok: false, error: 'gated' }
  }
  win.webContents.send('ws-open', id, msg.url, msg.protocols || [])
  return { ok: true, ws: id }
}

function close(id: number): void {
  const s = sockets.get(id)
  if (!s) return
  sockets.delete(id)
  if (!s.win.isDestroyed()) s.win.destroy()
  void forget(s.ses)
}

async function handle(msg: Msg): Promise<void> {
  if (msg.op === 'wsSend') {
    const s = sockets.get(msg.ws)
    if (s && !s.win.isDestroyed()) s.win.webContents.send('ws-send', msg.ws, msg.data)
    return
  }
  if (msg.op === 'wsClose') {
    const s = sockets.get(msg.ws)
    if (s && !s.win.isDestroyed()) s.win.webContents.send('ws-close', msg.ws)
    setTimeout(() => close(msg.ws), 2000)
    return
  }
  let answer: Msg
  try {
    if (msg.op === 'request') answer = await request(msg)
    else if (msg.op === 'clearGate') answer = await clearGate(msg)
    else if (msg.op === 'wsOpen') answer = await wsOpen(msg)
    else answer = { ok: false, error: `unknown op ${msg.op}` }
  } catch (e) {
    answer = { ok: false, error: (e as Error).message }
  }
  out({ id: msg.id, ...answer })
}

/**
 * Where instructions arrive: the pipe nobilis holds on our stdin.
 *
 * Not `process.stdin` on Windows. There Electron's main process hands out a
 * stdin that has already ended, though the pipe is open and nobilis is
 * writing to it - so the helper read "the daemon has gone", quit half a second
 * after saying it was ready, and every Sneedchat sign-in on Windows failed
 * with "the web helper stopped before answering" or sat at "Connecting...".
 * Reading descriptor 0 directly gets the pipe itself, and its end only when
 * nobilis really closes it.
 */
function instructions(): NodeJS.ReadableStream {
  if (process.platform !== 'win32') return process.stdin
  return fs.createReadStream('', { fd: 0, autoClose: false })
}

app.whenReady().then(() => {
  UA = session.defaultSession.getUserAgent().replace(/ Electron\/\S+/, '').replace(/ moho\/\S+/, '')
  const lines = readline.createInterface({ input: instructions() })
  lines.on('line', (line) => {
    let msg: Msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    void handle(msg)
  })
  lines.on('close', quit)
  out({ event: 'ready', version: process.versions.electron, userAgent: UA })
})
