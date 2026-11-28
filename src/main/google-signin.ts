import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Signing in to Google Chat in the person's own browser.
 *
 * Google's sign-in refuses any Electron window ("This browser or app may not be secure"), and not by its user agent:
 * a plain Chromium one and a Firefox one were both refused after the email, on 2026-11-27. Its check runs in the page
 * and looks at the engine. So the sign-in happens where Google has no complaint - a real browser, the one the person
 * uses (their default; another installed one if the default is one this cannot read a session from) - started for
 * this alone, with a fresh profile nothing else has touched, so their everyday browser and its own sign-ins are not
 * involved at all.
 *
 * Nothing drives the page: no automation, nothing injected, the browser is no less a browser than it is. What moho
 * reads is the session the sign-in leaves:
 *
 * - Firefox and its relatives write cookies unencrypted into the profile's `cookies.sqlite`, which is watched.
 * - Chromium-family browsers encrypt theirs on disk (on Windows with a key Chrome binds to itself), so they are asked
 *   instead: started with a local debugging port, and asked at the browser level - never attached to a page - for
 *   their cookies, which is a question Chromium answers for any client on this machine.
 *
 * Once Google's session cookies for chat.google.com are there, they go to the daemon with that browser's user agent,
 * the browser is closed and the profile deleted. The password goes only into Google's page.
 */

/** Long enough for a password manager, a second factor and a Workspace's single sign-on. */
const TIMEOUT_MS = 10 * 60 * 1000

/** Google's sign-in for Chat, as chat.google.com/u/0/ itself sends a signed-out visitor there. */
export const SIGN_IN_URL =
  'https://accounts.google.com/ServiceLogin?service=dynamite&osid=1&continue=https%3A%2F%2Fchat.google.com%2Fu%2F0%2F&hl=en'

/** The cookies without which there is no session. COMPASS is chat.google.com's own: set once the app has loaded. */
const NEEDED = ['SID', 'HSID', 'SSID', 'COMPASS']

type Engine = 'gecko' | 'chromium'

/** A browser that can be started for the sign-in. */
export interface Browser {
  /** What to call it to the person. */
  name: string
  /** The command that starts it, before moho's own arguments. */
  command: string[]
  engine: Engine
  /** Where a profile can be made that the browser can reach: a Flatpak or Snap sees only part of the disk. */
  profileBase: string
  /** Whether it is the person's default browser rather than a fallback. */
  isDefault: boolean
}

export interface GoogleSignIn {
  ok: boolean
  /** The session's cookies as a `Cookie:` header. A credential: never logged. */
  cookies?: string
  /** The browser's user agent, for the daemon's requests to match. */
  userAgent?: string
  /** Which browser it happened in. */
  browser?: string
  error?: string
}

// ---------------------------------------------------------------------------------------------------------------------
// Which browser

const GECKO = /(^|[\\/._-])(firefox|librewolf|waterfox|floorp|zen|icecat|iceweasel|mullvad-?browser|palemoon)([\\/._-]|$)/i
const CHROMIUM =
  /(^|[\\/._-])(chrome|chromium|google-chrome|msedge|microsoft-edge|edge|brave|brave-browser|vivaldi|opera|thorium|helium|yandex|ungoogled)([\\/._-]|$)/i

/** Which engine a command or Flatpak id is, by its name. */
export function engineOf(name: string): Engine | null {
  const base = name.toLowerCase()
  if (GECKO.test(base)) return 'gecko'
  if (CHROMIUM.test(base)) return 'chromium'
  return null
}

/** Splits a desktop entry's `Exec=` into arguments, dropping its field codes (%u, %U...) and Flatpak's `@@` markers. */
export function parseExec(exec: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  let any = false
  for (let i = 0; i < exec.length; i++) {
    const ch = exec[i]
    if (ch === '\\' && quoted && i + 1 < exec.length) {
      cur += exec[++i]
    } else if (ch === '"') {
      quoted = !quoted
      any = true
    } else if (/\s/.test(ch) && !quoted) {
      if (cur || any) out.push(cur)
      cur = ''
      any = false
    } else {
      cur += ch
    }
  }
  if (cur || any) out.push(cur)
  return out.filter((a) => !/^%[a-zA-Z%]$/.test(a) && a !== '@@' && a !== '@@u' && a !== '@@U')
}

/** The `[Desktop Entry]` group's `Exec` and `Name` of a .desktop file. */
export function readDesktopEntry(text: string): { exec?: string; name?: string } {
  let inMain = false
  const out: { exec?: string; name?: string } = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      inMain = line === '[Desktop Entry]'
      continue
    }
    if (!inMain) continue
    if (line.startsWith('Exec=') && !out.exec) out.exec = line.slice(5)
    if (line.startsWith('Name=') && !out.name) out.name = line.slice(5)
  }
  return out
}

/**
 * A browser from the command that starts it. A Flatpak or a Snap keeps its profile in a place of its own it can reach.
 */
export function browserFromCommand(command: string[], name: string, isDefault: boolean, home = os.homedir()): Browser | null {
  if (command.length === 0) return null
  const flatpak = command[0].endsWith('flatpak') && command.includes('run')
  if (flatpak) {
    const appId = command.find((a, i) => i > command.indexOf('run') && !a.startsWith('-'))
    const commandArg = command.find((a) => a.startsWith('--command='))?.slice('--command='.length) ?? ''
    const engine = engineOf(appId ?? '') ?? engineOf(commandArg)
    if (!appId || !engine) return null
    return { name, command, engine, profileBase: path.join(home, '.var', 'app', appId), isDefault }
  }
  const snap = /(^|\/)snap\/bin\/([^/]+)$/.exec(command[0])
  const engine = engineOf(path.basename(command[0])) ?? engineOf(command[0])
  if (!engine) return null
  if (snap) return { name, command, engine, profileBase: path.join(home, 'snap', snap[2], 'common'), isDefault }
  return { name, command, engine, profileBase: os.tmpdir(), isDefault }
}

function dataDirs(): string[] {
  const home = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
  const system = (process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':')
  return [home, ...system, path.join(os.homedir(), '.local/share/flatpak/exports/share'), '/var/lib/flatpak/exports/share', '/var/lib/snapd/desktop']
}

function desktopFile(id: string): string | null {
  for (const dir of dataDirs()) {
    const file = path.join(dir, 'applications', id)
    if (fs.existsSync(file)) return file
  }
  return null
}

function linuxDefault(): Browser | null {
  let id = ''
  try {
    id = execFileSync('xdg-settings', ['get', 'default-web-browser'], { encoding: 'utf8', timeout: 10000 }).trim()
  } catch {
    try {
      id = execFileSync('xdg-mime', ['query', 'default', 'x-scheme-handler/https'], { encoding: 'utf8', timeout: 10000 }).trim()
    } catch {
      return null
    }
  }
  const file = id ? desktopFile(id) : null
  if (!file) return null
  const entry = readDesktopEntry(fs.readFileSync(file, 'utf8'))
  if (!entry.exec) return null
  return browserFromCommand(parseExec(entry.exec), entry.name ?? id.replace(/\.desktop$/, ''), true)
}

/** One value from `reg query`, or nothing. */
function regValue(key: string, value: string | null): string | null {
  try {
    const out = execFileSync('reg', ['query', key, ...(value ? ['/v', value] : ['/ve'])], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const line = out.split(/\r?\n/).find((l) => /\sREG_(SZ|EXPAND_SZ)\s/.test(l))
    return line ? line.replace(/^.*?\sREG_(?:SZ|EXPAND_SZ)\s+/, '').trim() : null
  } catch {
    return null
  }
}

/** The program a Windows open command names: its first argument, quoted or not. */
export function windowsProgram(command: string): string | null {
  const m = /^\s*"([^"]+)"/.exec(command) ?? /^\s*(\S+\.exe)/i.exec(command)
  return m ? m[1] : null
}

/** What the usual browsers are called, by their program's name. */
export function friendlyName(program: string): string | null {
  const names: Record<string, string> = {
    msedge: 'Microsoft Edge',
    chrome: 'Google Chrome',
    firefox: 'Firefox',
    brave: 'Brave',
    vivaldi: 'Vivaldi',
    opera: 'Opera',
    librewolf: 'LibreWolf',
    chromium: 'Chromium'
  }
  return names[path.basename(program.replace(/\\/g, '/')).replace(/\.exe$/i, '').toLowerCase()] ?? null
}

function windowsDefault(): Browser | null {
  const base = 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https'
  const progId = regValue(`${base}\\UserChoiceLatest`, 'ProgId') ?? regValue(`${base}\\UserChoice`, 'ProgId')
  if (!progId) return null
  const open = regValue(`HKCR\\${progId}\\shell\\open\\command`, null)
  const exe = open ? windowsProgram(open) : null
  if (!exe || !fs.existsSync(exe)) return null
  const name = friendlyName(exe) ?? regValue(`HKCR\\${progId}`, null) ?? path.basename(exe, '.exe')
  return browserFromCommand([exe], name, true)
}

/** Installed browsers this can use, in the order a fallback tries them. */
function installed(): Browser[] {
  const found: Browser[] = []
  const add = (file: string, name: string): void => {
    try {
      fs.accessSync(file, fs.constants.X_OK)
    } catch {
      return
    }
    const b = browserFromCommand([file], name, false)
    if (b && !found.some((f) => f.command[0] === file)) found.push(b)
  }
  if (process.platform === 'win32') {
    for (const root of [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env['LOCALAPPDATA']]) {
      if (!root) continue
      add(path.join(root, 'Mozilla Firefox', 'firefox.exe'), 'Firefox')
      add(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'), 'Google Chrome')
      add(path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), 'Microsoft Edge')
      add(path.join(root, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), 'Brave')
    }
  } else if (process.platform === 'darwin') {
    add('/Applications/Firefox.app/Contents/MacOS/firefox', 'Firefox')
    add('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'Google Chrome')
  } else {
    const names: Array<[string, string]> = [
      ['firefox', 'Firefox'],
      ['google-chrome-stable', 'Google Chrome'],
      ['google-chrome', 'Google Chrome'],
      ['chromium', 'Chromium'],
      ['chromium-browser', 'Chromium'],
      ['brave', 'Brave'],
      ['brave-browser', 'Brave'],
      ['microsoft-edge-stable', 'Microsoft Edge'],
      ['vivaldi-stable', 'Vivaldi'],
      ['librewolf', 'LibreWolf'],
      ['firefox-esr', 'Firefox ESR']
    ]
    for (const [bin, name] of names) {
      for (const dir of (process.env.PATH ?? '').split(':').filter(Boolean)) add(path.join(dir, bin), name)
    }
  }
  return found
}

/** The browser to sign in with: the default, or - if it is not one this can read a session from - an installed one. */
export function pickBrowser(): { browser: Browser | null; defaultName?: string } {
  let def: Browser | null = null
  let defaultName: string | undefined
  try {
    def = process.platform === 'win32' ? windowsDefault() : process.platform === 'linux' ? linuxDefault() : null
  } catch {
    def = null
  }
  if (def) return { browser: def }
  if (process.platform === 'linux') {
    try {
      defaultName = execFileSync('xdg-settings', ['get', 'default-web-browser'], { encoding: 'utf8', timeout: 10000 }).trim().replace(/\.desktop$/, '')
    } catch {
      /* unknown */
    }
  }
  return { browser: installed()[0] ?? null, defaultName }
}

// ---------------------------------------------------------------------------------------------------------------------
// The session

interface CookieRow {
  name: string
  value: string
  host: string
  path: string
}

/**
 * The cookies the web app sends to chat.google.com/u/0/, from a profile's cookie rows: Google's own on .google.com,
 * and chat.google.com's. Where a name is set on both, or at two paths, the more specific one is what a browser sends
 * first and is the one kept.
 */
export function chatCookies(rows: CookieRow[]): Map<string, string> {
  const applies = (r: CookieRow): boolean =>
    (r.host === '.google.com' || r.host === 'google.com' || r.host === 'chat.google.com' || r.host === '.chat.google.com') &&
    '/u/0/'.startsWith(r.path.endsWith('/') ? r.path : `${r.path}/`)
  const rank = (r: CookieRow): number => (r.host.replace(/^\./, '') === 'chat.google.com' ? 1000 : 0) + r.path.length
  const best = new Map<string, CookieRow>()
  for (const row of rows.filter(applies)) {
    const held = best.get(row.name)
    if (!held || rank(row) > rank(held)) best.set(row.name, row)
  }
  return new Map([...best].map(([name, row]) => [name, row.value]))
}

/** Firefox's user agent for its version on this platform, the way Firefox writes it. */
export function firefoxUserAgent(version: string, platform: string = process.platform): string {
  const major = /^(\d+)/.exec(version)?.[1] ?? '140'
  const system =
    platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10.15' : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${system}; rv:${major}.0) Gecko/20100101 Firefox/${major}.0`
}

/**
 * What a fresh Firefox profile is told before it starts, so it opens straight onto the sign-in page: no first-run
 * pages, no default-browser question, no telemetry, no offer to keep the password.
 */
const USER_JS = [
  'user_pref("browser.shell.checkDefaultBrowser", false);',
  'user_pref("browser.aboutwelcome.enabled", false);',
  'user_pref("browser.startup.homepage_override.mstone", "ignore");',
  'user_pref("startup.homepage_welcome_url", "");',
  'user_pref("startup.homepage_welcome_url.additional", "");',
  'user_pref("browser.startup.firstrunSkipsHomepage", true);',
  'user_pref("trailhead.firstrun.didSeeAboutWelcome", true);',
  'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
  'user_pref("datareporting.healthreport.uploadEnabled", false);',
  'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
  'user_pref("app.update.auto", false);',
  'user_pref("browser.tabs.warnOnClose", false);',
  'user_pref("signon.rememberSignons", false);',
  ''
].join('\n')

/** Reads a Firefox profile's cookie file as it stands - a copy, with its write-ahead log, since Firefox holds it. */
export function readCookies(profile: string, scratch: string): CookieRow[] {
  const db = path.join(profile, 'cookies.sqlite')
  if (!fs.existsSync(db)) return []
  const copy = path.join(scratch, 'cookies.sqlite')
  for (const suffix of ['', '-wal']) {
    const from = db + suffix
    const to = copy + suffix
    fs.rmSync(to, { force: true })
    if (fs.existsSync(from)) fs.copyFileSync(from, to)
  }
  fs.rmSync(copy + '-shm', { force: true })
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
  const conn = new DatabaseSync(copy)
  try {
    return conn.prepare("SELECT name, value, host, path FROM moz_cookies WHERE host LIKE '%google.com'").all() as unknown as CookieRow[]
  } finally {
    conn.close()
  }
}

/** One question to a Chromium's browser-level DevTools endpoint. Never a page's. */
async function cdpCall(wsUrl: string, method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl)
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('no answer'))
    }, 10000)
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method, params })))
    socket.addEventListener('message', (e) => {
      const msg = JSON.parse(String(e.data)) as { id?: number; result?: Record<string, unknown>; error?: { message: string } }
      if (msg.id !== 1) return
      clearTimeout(timer)
      socket.close()
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result ?? {})
    })
    socket.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('could not reach the browser'))
    })
  })
}

/** The browser-level DevTools address a Chromium writes into its profile when started with port 0. */
function devtoolsUrl(profile: string): string | null {
  try {
    const [port, wsPath] = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)
    return port && wsPath ? `ws://127.0.0.1:${port.trim()}${wsPath.trim()}` : null
  } catch {
    return null
  }
}

export function launchArgs(browser: Browser, profile: string): string[] {
  if (browser.engine === 'gecko') {
    // On Windows the first firefox.exe hands over to another and leaves unless told to wait for the browser.
    return ['--no-remote', '--new-instance', ...(process.platform === 'win32' ? ['--wait-for-browser'] : []), '--profile', profile, SIGN_IN_URL]
  }
  // Nothing Google's page could notice: a debugging port while signing in is refused ("This browser or app may not
  // be secure", seen with Brave on 2026-11-27). Only a fresh profile and no first-run pages.
  return [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--new-window', SIGN_IN_URL]
}

/** Where a Chromium profile keeps its cookie database: newer ones under Network/, older ones beside it. */
function chromiumCookieFile(profile: string): string | null {
  for (const rel of [['Default', 'Network', 'Cookies'], ['Default', 'Cookies']]) {
    const file = path.join(profile, ...rel)
    if (fs.existsSync(file)) return file
  }
  return null
}

/**
 * Which cookies a Chromium profile holds, by name, host and path. The values are encrypted on disk, but these are not -
 * enough to tell that the sign-in has finished without asking the running browser anything.
 */
export function readChromiumCookieNames(profile: string, scratch: string): CookieRow[] {
  const file = chromiumCookieFile(profile)
  if (!file) return []
  const copy = path.join(scratch, 'Cookies')
  for (const suffix of ['', '-wal', '-journal']) fs.rmSync(copy + suffix, { force: true })
  fs.copyFileSync(file, copy)
  if (fs.existsSync(file + '-wal')) fs.copyFileSync(file + '-wal', copy + '-wal')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
  const conn = new DatabaseSync(copy)
  try {
    const rows = conn.prepare("SELECT name, host_key AS host, path FROM cookies WHERE host_key LIKE '%google.com'").all() as unknown as Array<Omit<CookieRow, 'value'>>
    return rows.map((r) => ({ ...r, value: '' }))
  } finally {
    conn.close()
  }
}

/**
 * The session out of a Chromium profile the person has finished with: the profile opened again headless - no page,
 * nothing for any site to see - and the browser asked for its cookies over its own DevTools, which decrypts them as
 * only it can (Chrome's app-bound encryption on Windows included). Then it is closed.
 */
export async function readChromiumSession(browser: Browser, profile: string): Promise<{ rows: CookieRow[]; userAgent: string }> {
  fs.rmSync(path.join(profile, 'DevToolsActivePort'), { force: true })
  const [program, ...pre] = browser.command
  const child = spawn(
    program,
    [...pre, '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', 'about:blank'],
    { detached: process.platform !== 'win32', stdio: 'ignore', windowsHide: true }
  )
  try {
    let url: string | null = null
    for (let i = 0; i < 60 && !url; i++) {
      await new Promise((r) => setTimeout(r, 250))
      url = devtoolsUrl(profile)
      if (child.exitCode !== null) break
    }
    if (!url) throw new Error(`${browser.name} did not open its profile again to hand over the session`)
    const result = await cdpCall(url, 'Storage.getCookies')
    const cookies = (result.cookies as Array<{ name: string; value: string; domain: string; path: string }>) ?? []
    const version = await cdpCall(url, 'Browser.getVersion').catch(() => ({}) as Record<string, unknown>)
    await cdpCall(url, 'Browser.close').catch(() => undefined)
    return {
      rows: cookies.map((c) => ({ name: c.name, value: c.value, host: c.domain, path: c.path })),
      // Headless says so in its user agent; the window the person signed in with did not.
      userAgent: String(version.userAgent ?? '').replace('HeadlessChrome/', 'Chrome/')
    }
  } finally {
    await waitForExit(child, 5000)
    stop(child)
  }
}

/** Waits for a process to end on its own, up to a limit. */
export async function waitForExit(child: ChildProcess, ms: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/** Asks a browser to close as a person closing it would, so it writes out what it holds. */
export function closeGently(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return
  try {
    // Not /T: that asks each helper process first, which only a forced kill ends, and the window is never asked.
    // The browser's own process alone is asked, as its window's close button would, and it ends its helpers itself.
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true })
    else process.kill(-child.pid, 'SIGTERM')
  } catch {
    /* already gone */
  }
}

function geckoVersion(command: string[]): string {
  if (command[0].endsWith('flatpak')) return ''
  try {
    const out = execFileSync(command[0], ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true })
    return /([\d]+\.[\d.]+)/.exec(out)?.[1] ?? ''
  } catch {
    return ''
  }
}

function stop(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    else process.kill(-child.pid, 'SIGTERM')
  } catch {
    /* already gone */
  }
}

let running: Promise<GoogleSignIn> | null = null

/** Opens the browser on Google's Chat sign-in and resolves with the session once the person is in. One at a time. */
export function googleSignIn(trace?: (message: string) => void, use?: Browser): Promise<GoogleSignIn> {
  if (running) return Promise.resolve({ ok: false, error: 'A Google sign-in is already open' })
  running = run(trace, use).finally(() => {
    running = null
  })
  return running
}

function header(jar: Map<string, string>): string {
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
}

async function run(trace?: (message: string) => void, use?: Browser): Promise<GoogleSignIn> {
  const { browser, defaultName } = use ? { browser: use, defaultName: undefined } : pickBrowser()
  if (!browser) {
    return {
      ok: false,
      error:
        'Google refuses to sign in from inside apps like moho, so Google Chat signs in through your web browser - and no browser moho can use was found. Install Firefox, Chrome, Edge, Brave or Chromium and try again.'
    }
  }
  trace?.(
    browser.isDefault
      ? `signing in with the default browser, ${browser.name} (${browser.engine})`
      : `the default browser${defaultName ? ` (${defaultName})` : ''} cannot be used; signing in with ${browser.name} (${browser.engine})`
  )
  fs.mkdirSync(browser.profileBase, { recursive: true })
  sweepStaleProfiles([os.tmpdir(), browser.profileBase])
  const base = fs.mkdtempSync(path.join(browser.profileBase, 'moho-google-'))
  const profile = path.join(base, 'profile')
  const scratch = path.join(base, 'read')
  fs.mkdirSync(profile, { mode: 0o700 })
  fs.mkdirSync(scratch, { mode: 0o700 })
  if (browser.engine === 'gecko') fs.writeFileSync(path.join(profile, 'user.js'), USER_JS)
  const userAgentFallback = browser.engine === 'gecko' ? firefoxUserAgent(geckoVersion(browser.command)) : ''
  const [program, ...pre] = browser.command
  const child = spawn(program, [...pre, ...launchArgs(browser, profile)], {
    detached: process.platform !== 'win32',
    stdio: 'ignore',
    windowsHide: false
  })

  const look = async (): Promise<{ jar: Map<string, string>; userAgent: string } | null> => {
    if (browser.engine === 'gecko') return { jar: chatCookies(readCookies(profile, scratch)), userAgent: userAgentFallback }
    // Names only: the values come once the browser is closed (readChromiumSession). Chromium writes its cookies out
    // every half minute or so, so this can trail the sign-in by that much.
    return { jar: chatCookies(readChromiumCookieNames(profile, scratch)), userAgent: '' }
  }

  try {
    return await new Promise<GoogleSignIn>((resolve) => {
      let settled = false
      const done = (outcome: GoogleSignIn): void => {
        if (settled) return
        settled = true
        clearInterval(poll)
        clearTimeout(timer)
        resolve(outcome)
      }
      const timer = setTimeout(() => done({ ok: false, error: 'Timed out waiting for the Google sign-in to finish' }), TIMEOUT_MS)
      child.on('error', (e) => done({ ok: false, error: `Could not start ${browser.name}: ${e.message}` }))
      let chromiumReady = false
      // The session out of a Chromium that has closed: there if the person signed in, not if they gave up.
      const finishChromium = async (): Promise<void> => {
        try {
          const session = await readChromiumSession(browser, profile)
          const jar = chatCookies(session.rows)
          if (NEEDED.every((n) => jar.has(n))) done({ ok: true, cookies: header(jar), userAgent: session.userAgent, browser: browser.name })
          else done({ ok: false, error: 'cancelled' })
        } catch (e) {
          done({ ok: false, error: `The session could not be read from ${browser.name}: ${(e as Error).message}` })
        }
      }
      child.on('exit', () => {
        if (chromiumReady) return
        // A Chromium closed by the person - the way a sign-in ends on Windows, where its cookie file cannot be watched.
        if (browser.engine === 'chromium') {
          chromiumReady = true
          trace?.(`${browser.name} was closed; reading the session`)
          void finishChromium()
          return
        }
        // One last look at a Firefox profile: the window may have been closed the moment the app loaded.
        if (browser.engine === 'gecko') {
          try {
            const jar = chatCookies(readCookies(profile, scratch))
            if (NEEDED.every((n) => jar.has(n))) return done({ ok: true, cookies: header(jar), userAgent: userAgentFallback, browser: browser.name })
          } catch {
            /* nothing readable */
          }
        }
        done({ ok: false, error: 'cancelled' })
      })
      let seenAt = 0
      let busy = false
      const poll = setInterval(() => {
        if (busy) return
        busy = true
        void look()
          .then(async (seen) => {
            if (!seen || !NEEDED.every((n) => seen.jar.has(n))) return
            // A moment more once the app's own cookie is there, for the rest it sets as it loads.
            if (!seenAt) {
              seenAt = Date.now()
              trace?.('Google’s session is in the profile')
              return
            }
            if (Date.now() - seenAt < 3000) return
            if (browser.engine === 'chromium') {
              // Signed in: the browser is closed (writing out its cookies as it goes) and asked for them headless.
              chromiumReady = true
              trace?.(`closing ${browser.name} to read the session`)
              closeGently(child)
              await waitForExit(child, 15000)
              stop(child)
              await finishChromium()
              return
            }
            done({ ok: true, cookies: header(seen.jar), userAgent: seen.userAgent, browser: browser.name })
          })
          .catch(() => {
            /* written to as it was read, or not listening yet: the next look will do */
          })
          .finally(() => {
            busy = false
          })
      }, 1500)
    })
  } finally {
    stop(child)
    await waitForExit(child, 5000)
    // The session is on disk in the profile until this: deleted before anything is answered, and tried again while
    // the browser is still letting go of its files (Windows will not delete a file a process holds).
    await removeProfile(base)
  }
}

async function removeProfile(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      if (!fs.existsSync(dir)) return
    } catch {
      /* still held */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
}

/**
 * Profiles a sign-in that never finished left behind - moho quit or crashed mid-way - each holding whatever session it
 * got. Any older than a sign-in can last are deleted before a new one starts.
 */
function sweepStaleProfiles(bases: string[]): void {
  for (const base of new Set(bases)) {
    let entries: string[] = []
    try {
      entries = fs.readdirSync(base).filter((d) => d.startsWith('moho-google-'))
    } catch {
      continue
    }
    for (const entry of entries) {
      const dir = path.join(base, entry)
      try {
        if (Date.now() - fs.statSync(dir).mtimeMs > TIMEOUT_MS + 60_000) fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        /* in use, or gone */
      }
    }
  }
}
