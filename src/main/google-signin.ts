import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Signing in to Google Chat in Firefox.
 *
 * Google's sign-in refuses any Electron window ("This browser or app may not be secure"), and not by its user agent:
 * a plain Chromium one and a Firefox one were both refused after the email, on 2026-11-27. Its check runs in the
 * page and looks at the engine. Rather than an arms race with that, the sign-in happens where Google has no complaint:
 * a real Firefox, started for this alone with a profile of its own that nothing else has touched.
 *
 * moho does not drive it - no automation, no remote control, nothing that makes it less of a browser than it is. It
 * watches the profile's cookie file, which Firefox writes as it goes, and once Google's session cookies for
 * chat.google.com are in it, reads them, closes that Firefox and deletes the profile. The password goes only into
 * Google's page; what moho keeps is the session, as it does for every browser sign-in.
 */

/** Long enough for a password manager, a second factor and a Workspace's single sign-on. */
const TIMEOUT_MS = 10 * 60 * 1000

/** Google's sign-in for Chat, as chat.google.com/u/0/ itself sends a signed-out visitor there. */
const SIGN_IN_URL = 'https://accounts.google.com/ServiceLogin?service=dynamite&osid=1&continue=https%3A%2F%2Fchat.google.com%2Fu%2F0%2F&hl=en'

/** The cookies without which there is no session. COMPASS is chat.google.com's own: set once the app has loaded. */
const NEEDED = ['SID', 'HSID', 'SSID', 'COMPASS']

/**
 * What a fresh profile is told before it starts, so it opens straight onto the sign-in page: no first-run pages, no
 * default-browser question, no telemetry, and the cookie file written without delay.
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

export interface GoogleSignIn {
  ok: boolean
  /** The session's cookies as a `Cookie:` header. A credential: never logged. */
  cookies?: string
  /** The Firefox's user agent, for the daemon's requests to match. */
  userAgent?: string
  error?: string
}

/** Where Firefox is on this machine, if it is. */
export function findFirefox(platform: string = process.platform): string | null {
  const candidates: string[] = []
  if (platform === 'win32') {
    for (const base of [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env['LOCALAPPDATA']]) {
      if (base) candidates.push(path.join(base, 'Mozilla Firefox', 'firefox.exe'))
    }
  } else if (platform === 'darwin') {
    candidates.push('/Applications/Firefox.app/Contents/MacOS/firefox', path.join(os.homedir(), 'Applications/Firefox.app/Contents/MacOS/firefox'))
  } else {
    for (const dir of (process.env.PATH ?? '').split(':').filter(Boolean)) {
      for (const name of ['firefox', 'firefox-esr']) candidates.push(path.join(dir, name))
    }
    candidates.push('/usr/lib/firefox/firefox', '/opt/firefox/firefox', '/snap/bin/firefox')
  }
  return candidates.find((c) => {
    try {
      fs.accessSync(c, fs.constants.X_OK)
      return true
    } catch {
      return false
    }
  }) ?? null
}

/** Firefox's user agent for its version on this platform, the way Firefox writes it. */
export function firefoxUserAgent(version: string, platform: string = process.platform): string {
  const major = /^(\d+)/.exec(version)?.[1] ?? '140'
  const os =
    platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10.15' : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${os}; rv:${major}.0) Gecko/20100101 Firefox/${major}.0`
}

function firefoxVersion(binary: string): string {
  try {
    const out = execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 15000 })
    return /Firefox\s+([\d.]+)/i.exec(out)?.[1] ?? ''
  } catch {
    return ''
  }
}

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

/** Reads the profile's cookie file as it stands - a copy, with its write-ahead log, since Firefox holds the file. */
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
    return conn
      .prepare("SELECT name, value, host, path FROM moz_cookies WHERE host LIKE '%google.com'")
      .all() as unknown as CookieRow[]
  } finally {
    conn.close()
  }
}

function stop(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(-child.pid, 'SIGTERM')
  } catch {
    /* already gone */
  }
}

let running: Promise<GoogleSignIn> | null = null

/**
 * Opens Firefox on Google's Chat sign-in and resolves with the session once the person is signed in. One at a time.
 * Closing that Firefox is a cancel.
 */
export function googleSignIn(trace?: (message: string) => void): Promise<GoogleSignIn> {
  if (running) return Promise.resolve({ ok: false, error: 'A Google sign-in is already open' })
  running = run(trace).finally(() => {
    running = null
  })
  return running
}

async function run(trace?: (message: string) => void): Promise<GoogleSignIn> {
  const binary = findFirefox()
  if (!binary) {
    return {
      ok: false,
      error:
        'Google refuses to sign in from inside apps like moho, so Google Chat signs in through Firefox - and Firefox was not found. Install Firefox and try again.'
    }
  }
  const userAgent = firefoxUserAgent(firefoxVersion(binary))
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'moho-google-'))
  const profile = path.join(base, 'profile')
  const scratch = path.join(base, 'read')
  fs.mkdirSync(profile, { mode: 0o700 })
  fs.mkdirSync(scratch, { mode: 0o700 })
  fs.writeFileSync(path.join(profile, 'user.js'), USER_JS)
  trace?.('opening Firefox with a profile of its own on Google’s sign-in')
  const child = spawn(binary, ['--no-remote', '--new-instance', '--profile', profile, SIGN_IN_URL], {
    detached: process.platform !== 'win32',
    stdio: 'ignore'
  })

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
      child.on('error', (e) => done({ ok: false, error: `Could not start Firefox: ${e.message}` }))
      child.on('exit', () => {
        // One last look: the window may have been closed the moment the app loaded.
        try {
          const jar = chatCookies(readCookies(profile, scratch))
          if (NEEDED.every((n) => jar.has(n))) return done({ ok: true, cookies: header(jar), userAgent })
        } catch {
          /* nothing readable */
        }
        done({ ok: false, error: 'cancelled' })
      })
      let seenAt = 0
      const poll = setInterval(() => {
        let jar: Map<string, string>
        try {
          jar = chatCookies(readCookies(profile, scratch))
        } catch {
          return // written to as it was read: the next look will do
        }
        if (!NEEDED.every((n) => jar.has(n))) return
        // A moment more once the app's own cookie is there, for the rest it sets as it loads.
        if (!seenAt) {
          seenAt = Date.now()
          trace?.('Google’s session is in the profile')
          return
        }
        if (Date.now() - seenAt < 3000) return
        done({ ok: true, cookies: header(jar), userAgent })
      }, 1500)
    })
  } finally {
    stop(child)
    // Firefox lets go of the profile as it exits; then nothing of the session is left on disk.
    setTimeout(() => fs.rmSync(base, { recursive: true, force: true }), 3000)
  }
}

function header(jar: Map<string, string>): string {
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
}
