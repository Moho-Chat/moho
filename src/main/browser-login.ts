import { routeSession } from './tunnel'
import { BrowserWindow, session } from 'electron'
import type { Session } from 'electron'

/**
 * Signing in by letting the service's own login page do it.
 *
 * The alternative is posting credentials at an auth endpoint ourselves, which
 * fails for every service worth supporting and fails in the worst way: a
 * captcha we cannot render, a device check we cannot answer, an MFA prompt we
 * would have to reimplement, and - because a bare HTTP client submitting
 * passwords looks exactly like one trying a list of them - a black mark on the
 * account for trying. Discord refuses outright and files a warning against the
 * account each time.
 *
 * A real browser window sidesteps all of it by not being a workaround. The
 * page is the service's own, so its captcha, its MFA and its device
 * verification simply work, and the fingerprint it presents is genuine because
 * it is genuinely Chromium loading their page. Nothing here claims to be
 * anything it is not.
 *
 * Two properties matter and are worth stating plainly, because the design is
 * built around them: the password is typed into the service's form and this
 * process never sees it, and the session is thrown away afterwards so nothing
 * is left on disk to steal.
 */

/** How a service's credential shows up once the sign-in succeeds. */
export type Capture =
  /** A request header the page starts sending - Discord's Authorization. */
  | { kind: 'header'; name: string }
  /** A cookie the service sets - the usual shape for forum software. */
  | {
      kind: 'cookie'
      name: string
      url: string
      /**
       * Where the same value is to be had if the named cookie is not there: another cookie holding JSON with
       * the value under a key. Twitch's page-readable `twilight-user` carries the token its `auth-token` cookie does.
       */
      fallback?: { name: string; key: string }
    }
  /** A parameter on a redirect the service lands on - SSO, mostly. */
  | { kind: 'query'; param: string }
  /**
   * Every cookie the site holds, once the page says somebody is signed in.
   *
   * Forum software keeps a session across two or three cookies whose names
   * and lifetimes are its own business, so this takes the lot rather than
   * naming one - and waits for the page itself to say the sign-in finished,
   * because a session cookie exists for a guest too and looks identical.
   */
  | { kind: 'cookies'; url: string; signedIn: string }

export interface LoginFlow {
  /** Shown in the window's title bar, so it is obvious whose page this is. */
  label: string
  /** Where the sign-in starts. */
  url: string
  /**
   * Which requests to inspect, as Electron URL patterns.
   *
   * Deliberately narrow, and narrower than where the window may navigate: a
   * login can legitimately bounce through a captcha provider or an identity
   * provider, and those are none of our business to read.
   */
  watch: string[]
  capture: Capture
  /**
   * The daemon call that turns the captured value into a signed-in account,
   * and the parameter to hand it over as.
   *
   * Named here so the value can go straight from the login window to the
   * daemon without passing through the renderer. It is a credential; the
   * fewer places it exists, the better.
   */
  finish: { method: string; param: string }
  /**
   * One more thing to read off the signed-in page, if the flow needs it.
   *
   * Not a credential and not what the sign-in is for - it exists because an
   * account has to be called something, and the page somebody has just signed
   * into is the only place that knows what. Sent alongside the credential as
   * a second parameter; a page that does not answer simply sends nothing.
   */
  alsoRead?: { param: string; script: string }
  /**
   * Present the window as the Chromium it is, without the `Electron/` and `moho/` words Electron adds to the user
   * agent. Google refuses to sign anybody in from a page whose user agent names an embedded browser ("This browser or
   * app may not be secure"), whatever the browser underneath.
   */
  plainUserAgent?: boolean
}

/** The user agent Chromium itself would send: Electron's, without the words naming Electron and the app. */
export function plainUserAgent(ua: string): string {
  return ua
    .replace(/\s(Electron|moho)\/\S+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * The services this can sign in to.
 *
 * One table so adding the next one is an entry rather than a new code path.
 * It lives in main rather than in the daemon despite being protocol knowledge,
 * because it is only actionable by something that can open a window - a
 * headless frontend could not use it if it were handed over.
 */
export const LOGIN_FLOWS: Record<string, LoginFlow> = {
  discord: {
    label: 'Discord',
    url: 'https://discord.com/login',
    // Only Discord's own API. The login page loads hCaptcha and a CDN, and
    // neither carries anything worth looking at.
    watch: ['https://discord.com/api/*'],
    // The web client attaches the token to every API call it makes once
    // signed in, so the first authenticated request is the answer.
    capture: { kind: 'header', name: 'authorization' },
    finish: { method: 'addDiscordAccountToken', param: 'token' }
  },
  sneedchat: {
    label: 'Kiwi Farms',
    // The clearnet host rather than the onion this account may be configured
    // for: this window is Chromium with no Tor of its own, and the session it
    // comes back with is the forum's, not one host's. The daemon goes on
    // reaching the site however it was told to.
    url: 'https://kiwifarms.st/login/',
    // Nothing. The credential here is a cookie the site sets, not a request
    // this needs to read - so no request is read.
    watch: [],
    // XenForo marks its own <html> when somebody is signed in, which is the
    // same signal the daemon trusts over a cookie's mere presence.
    capture: {
      kind: 'cookies',
      url: 'https://kiwifarms.st/',
      signedIn: "document.documentElement.getAttribute('data-logged-in') === 'true'"
    },
    finish: { method: 'setSneedChatCookies', param: 'cookies' },
    // Who just signed in, as the forum's own navigation writes it. Wanted
    // because moho decides what counts as a mention of you by name, and
    // because an account has to be called something - with the login form
    // gone there is nowhere else left to ask. Best-effort: a page that does
    // not answer leaves an already-added account's name alone.
    alsoRead: {
      param: 'username',
      script:
        "(document.querySelector('.p-navgroup-user-linkText') || document.querySelector('.p-navgroup-link--user .p-navgroup-linkText'))?.textContent?.trim() || null"
    }
  },
  twitch: {
    label: 'Twitch',
    url: 'https://www.twitch.tv/login',
    // Nothing: the credential is a cookie the site sets, not a request to read.
    watch: [],
    // The website's own session token, which is what Twitch's player calls accept for playing a stream as the
    // person who signed in - their Turbo, their subscriptions - and which a token from moho's own sign-in
    // (made for chat and the official API) is not. It goes straight to the daemon, for the account named.
    capture: { kind: 'cookie', name: 'auth-token', url: 'https://www.twitch.tv', fallback: { name: 'twilight-user', key: 'authToken' } },
    finish: { method: 'setTwitchWebToken', param: 'token' }
  },
  googlechat: {
    label: 'Google',
    // Google's sign-in for Chat, as chat.google.com/u/0/ itself sends a signed-out visitor there (the bare
    // chat.google.com goes to a product page instead). `osid=1` has the session's OSID cookie made too.
    url: 'https://accounts.google.com/ServiceLogin?service=dynamite&osid=1&continue=https%3A%2F%2Fchat.google.com%2Fu%2F0%2F&hl=en',
    // Nothing is read off a request: the session is the cookies Google sets.
    watch: [],
    // Every cookie the web app sends to chat.google.com (Google's own, set on .google.com, and the app's COMPASS and
    // OSID) - but only once the page is the web app with somebody signed in, not a sign-in step along the way.
    capture: {
      kind: 'cookies',
      url: 'https://chat.google.com/u/0/',
      signedIn:
        "(() => { try { const w = window.WIZ_global_data; return location.hostname === 'chat.google.com' && !(w && w.qwAQke === 'AccountsSignInUi') } catch (e) { return false } })()"
    },
    finish: { method: 'addGoogleChatAccount', param: 'cookies' },
    // The daemon's requests carry the window's own user agent, so Google sees the session used by one browser.
    alsoRead: { param: 'userAgent', script: 'navigator.userAgent' },
    plainUserAgent: true
  },
  kick: {
    label: 'Kick',
    url: 'https://kick.com/',
    // Kick's own API and nothing else. The page pulls in Cloudflare's
    // challenge, a video player and an ad network, none of which are ours to
    // read - and the challenge in particular is the reason this is a real
    // browser rather than an HTTP client.
    watch: ['https://kick.com/api/*'],
    // The session travels as a bearer header on every API call the page makes
    // once signed in, so the first authenticated request is the answer - the
    // same shape as Discord's, and the reason both are one table entry rather
    // than two code paths.
    capture: { kind: 'header', name: 'authorization' },
    finish: { method: 'addKickAccount', param: 'token' }
  }
}

/**
 * Signing in to a Mattermost server on its own page: the way in for single sign-on (GitLab, SAML, OpenID, LDAP), whose
 * pages moho cannot stand in for. Once signed in the server keeps the session in its `MMAUTHTOKEN` cookie, which is
 * what this takes - the same session token a password sign-in would have been given. `null` for an address that is
 * not a web server's.
 */
export function mattermostFlow(server: string): LoginFlow | null {
  let url: URL
  try {
    url = new URL(/^[a-z]+:\/\//i.test(server.trim()) ? server.trim() : `https://${server.trim()}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const base = `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  return {
    label: 'Mattermost',
    url: `${base}/login`,
    // Nothing is read off a request: the session is a cookie the server sets.
    watch: [],
    capture: { kind: 'cookie', name: 'MMAUTHTOKEN', url: `${base}/` },
    finish: { method: 'addMattermostAccountToken', param: 'token' }
  }
}

export interface LoginOutcome {
  ok: boolean
  /** Present only on success. A credential: never log it, never persist it. */
  value?: string
  /** Whatever `alsoRead` found, if the flow asked for anything and it did. */
  extra?: { param: string; value: string }
  /** Why it did not succeed, for showing to a person. */
  error?: string
}

/** Long enough to find a password manager and answer an MFA prompt. */
const TIMEOUT_MS = 5 * 60 * 1000

let openWindow: BrowserWindow | null = null

/**
 * Opens the service's login page and resolves with whatever the flow captures.
 *
 * One at a time: two of these racing would leave two windows both claiming to
 * be signing in, and the second would inherit the first's half-finished
 * session.
 */
export async function browserLogin(
  service: string,
  options?: {
    /**
     * Keeps the window open once the credential is captured, for a flow that goes on in it: called with the
     * credential and the window, and the window closes when what it returns settles. Twitch's: signing in on
     * twitch.tv and then, in the same window and the same session, approving the code that gives the chat
     * connection its token.
     */
    hold?: (value: string, win: BrowserWindow) => Promise<void>
    /** Said at each step, without any credential in it, for the log. */
    trace?: (message: string) => void
    /** The flow, where it is made for one server rather than listed: a Mattermost server is wherever the person says. */
    flow?: LoginFlow
  }
): Promise<LoginOutcome> {
  const flow = options?.flow ?? LOGIN_FLOWS[service]
  if (!flow) return { ok: false, error: `No browser sign-in is defined for ${service}` }
  if (openWindow && !openWindow.isDestroyed()) {
    openWindow.focus()
    return { ok: false, error: 'A sign-in window is already open' }
  }

  // A partition with no "persist:" prefix is memory-only: cookies, storage and
  // cache exist while the window does and are gone with it. That is the whole
  // security story here - an abandoned sign-in leaves nothing behind, and
  // neither does a completed one.
  const partition = `moho-login-${service}-${Date.now()}`
  const ses = session.fromPartition(partition)
  // Through Tor or the proxy when everything is tunnelled, like the window.
  await routeSession(ses)
  if (flow.plainUserAgent) ses.setUserAgent(plainUserAgent(ses.getUserAgent()))

  const win = new BrowserWindow({
    width: 520,
    height: 760,
    title: `Sign in to ${flow.label}`,
    autoHideMenuBar: true,
    backgroundColor: '#101418',
    webPreferences: {
      partition,
      // Untrusted third-party content. No preload, no node, and its own
      // renderer process - this window can reach nothing of moho's.
      preload: undefined,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })
  openWindow = win
  // The session's user agent alone does not reach a window's pages; the window is told too.
  if (flow.plainUserAgent) win.webContents.setUserAgent(plainUserAgent(win.webContents.getUserAgent()))

  // This window has no address bar, so the title is the only thing that says
  // where you are - which matters, because typing a password into a page you
  // cannot identify is the shape of every phishing attack there is. The page
  // is not allowed to rename it, and the host is shown alongside so a redirect
  // somewhere unexpected is visible rather than silent.
  const retitle = (): void => {
    let host = ''
    try {
      host = new URL(win.webContents.getURL()).host
    } catch {
      /* nothing loaded yet */
    }
    if (!win.isDestroyed()) win.setTitle(host ? `Sign in to ${flow.label} — ${host}` : `Sign in to ${flow.label}`)
  }
  win.on('page-title-updated', (e) => {
    e.preventDefault()
    retitle()
  })
  if (options?.trace) {
    const trace = options.trace
    win.webContents.on('did-navigate', (_e, url) => {
      try {
        const u = new URL(url)
        trace(`the window is at ${u.host}${u.pathname}`)
      } catch {
        /* not a URL */
      }
    })
  }
  win.webContents.on('did-navigate', retitle)
  win.webContents.on('did-navigate-in-page', retitle)
  retitle()

  return await new Promise<LoginOutcome>((resolve) => {
    let settled = false
    const finish = (outcome: LoginOutcome): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      detach(ses)
      if (!win.isDestroyed()) win.destroy()
      openWindow = null
      // Belt and braces alongside the memory-only partition: an explicit wipe
      // means a future change to a persistent partition cannot silently start
      // leaving a live session on disk.
      void ses.clearStorageData()
      resolve(outcome)
    }

    const timer = setTimeout(
      () => finish({ ok: false, error: 'Timed out waiting for the sign-in to finish' }),
      TIMEOUT_MS
    )

    let holding = false
    watch(ses, win, flow, (value) => {
      if (options?.hold) {
        // The credential shows up more than once as cookies change; the flow is told once.
        if (holding) return
        holding = true
        options.trace?.('signed in on twitch.tv; the session was found')
        void options
          .hold(value, win)
          .then(() => finish({ ok: true, value }))
          .catch((e: Error) => finish({ ok: false, error: e.message }))
        return
      }
      // Read before finishing, because finishing destroys the window - and
      // best-effort, because this is a nicety and the credential is not.
      const also = flow.alsoRead
      if (!also || win.isDestroyed()) {
        finish({ ok: true, value })
        return
      }
      void win.webContents
        .executeJavaScript(also.script, true)
        .then((read: unknown) => {
          const text = typeof read === 'string' ? read.trim() : ''
          finish({ ok: true, value, ...(text ? { extra: { param: also.param, value: text } } : {}) })
        })
        .catch(() => finish({ ok: true, value }))
    })

    // Closing the window is a decision, not a failure - reported so the caller
    // can go quiet rather than showing an error nobody caused.
    win.on('closed', () => finish({ ok: false, error: 'cancelled' }))

    win.loadURL(flow.url).catch((e: Error) =>
      finish({ ok: false, error: `Could not open ${flow.label}'s sign-in page: ${e.message}` })
    )
  })
}

function watch(ses: Session, win: BrowserWindow, flow: LoginFlow, found: (value: string) => void): void {
  if (flow.capture.kind === 'cookies') {
    const { url, signedIn } = flow.capture
    // Asked of the page after each navigation rather than watched for on the
    // cookie jar: the jar changes constantly during a sign-in - a gate, a
    // guest session, a CSRF token - and none of that means anybody is in yet.
    const check = (): void => {
      if (win.isDestroyed()) return
      void win.webContents
        .executeJavaScript(signedIn, true)
        .then((yes: unknown) => {
          if (yes !== true) return
          return ses.cookies.get({ url }).then((cookies) => {
            const header = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
            if (header) found(header)
          })
        })
        .catch(() => {
          /* a page mid-navigation cannot be asked; the next one will be */
        })
    }
    win.webContents.on('did-navigate', check)
    win.webContents.on('did-navigate-in-page', check)
    win.webContents.on('did-finish-load', check)
    return
  }


  if (flow.capture.kind === 'header') {
    const wanted = flow.capture.name.toLowerCase()
    ses.webRequest.onBeforeSendHeaders({ urls: flow.watch }, (details, callback) => {
      // Pass the request through untouched whatever happens: this is an
      // observer, and a login that breaks because we interfered with it would
      // be a poor sort of sign-in window.
      callback({ requestHeaders: details.requestHeaders })
      for (const [name, value] of Object.entries(details.requestHeaders)) {
        if (name.toLowerCase() !== wanted) continue
        const token = String(value).trim()
        // The page makes unauthenticated API calls before sign-in too, and
        // some carry an empty or placeholder header.
        if (token && token.toLowerCase() !== 'undefined' && token.toLowerCase() !== 'null') {
          found(token)
        }
      }
    })
    return
  }

  if (flow.capture.kind === 'cookie') {
    const { name, url, fallback } = flow.capture
    const check = (): void => {
      void ses.cookies.get({ url }).then((cookies) => {
        let value = cookies.find((c) => c.name === name)?.value
        if (!value && fallback) {
          const holder = cookies.find((c) => c.name === fallback.name)?.value
          if (holder) {
            try {
              const parsed = JSON.parse(decodeURIComponent(holder)) as Record<string, unknown>
              const token = parsed[fallback.key]
              if (typeof token === 'string') value = token
            } catch {
              /* not JSON yet; the next change will be */
            }
          }
        }
        if (value) found(value)
      })
    }
    ses.cookies.on('changed', check)
    // Also after each page, in case the sign-in ended in a redirect that the cookie jar's own events did not announce.
    if (!win.isDestroyed()) {
      win.webContents.on('did-navigate', check)
      win.webContents.on('did-finish-load', check)
    }
    check()
    return
  }

  const { param } = flow.capture
  ses.webRequest.onBeforeRequest({ urls: flow.watch }, (details, callback) => {
    callback({})
    try {
      const value = new URL(details.url).searchParams.get(param)
      if (value) found(value)
    } catch {
      /* not a URL we can parse; nothing to take from it */
    }
  })
}

/**
 * Stops listening.
 *
 * Electron takes one handler per session for each of these, and passing null
 * is how it is removed - left attached, a finished flow would go on reading
 * headers from a session that is about to be wiped.
 */
function detach(ses: Session): void {
  ses.webRequest.onBeforeSendHeaders(null)
  ses.webRequest.onBeforeRequest(null)
  ses.cookies.removeAllListeners('changed')
}

/**
 * Isolated SSO browser login for self-hosted Rocket.Chat servers (OAuth, SAML, OIDC, LDAP).
 * Opens the server's own login page in a memory-only partition and captures `Meteor.loginToken`
 * (and `Meteor.userId`) from `localStorage` once signed in, then discards the session.
 */
export async function rocketchatSsoLogin(
  rawServerUrl: string
): Promise<{ ok: boolean; token?: string; userId?: string; error?: string }> {
  const base = rawServerUrl.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) {
    return { ok: false, error: 'Rocket.Chat server URL must start with http:// or https://' }
  }
  if (openWindow && !openWindow.isDestroyed()) {
    openWindow.focus()
    return { ok: false, error: 'A sign-in window is already open' }
  }

  const partition = `moho-login-rocketchat-${Date.now()}`
  const ses = session.fromPartition(partition)
  await routeSession(ses)

  const win = new BrowserWindow({
    width: 540,
    height: 760,
    title: 'Sign in to Rocket.Chat',
    autoHideMenuBar: true,
    backgroundColor: '#101418',
    webPreferences: {
      partition,
      preload: undefined,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })
  openWindow = win

  return await new Promise((resolve) => {
    let settled = false
    const finish = (out: { ok: boolean; token?: string; userId?: string; error?: string }): void => {
      if (settled) return
      settled = true
      clearInterval(timer)
      if (!win.isDestroyed()) win.close()
      if (openWindow === win) openWindow = null
      void ses.clearStorageData().catch(() => {})
      resolve(out)
    }

    const poll = async (): Promise<void> => {
      if (settled || win.isDestroyed()) return
      try {
        const res = (await win.webContents.executeJavaScript(
          `(() => {
            try {
              const token = window.localStorage.getItem('Meteor.loginToken');
              const userId = window.localStorage.getItem('Meteor.userId') || '';
              return token ? { token, userId } : null;
            } catch { return null; }
          })()`,
          true
        )) as { token: string; userId: string } | null
        if (res?.token) {
          finish({ ok: true, token: res.token, userId: res.userId })
        }
      } catch {
        /* page still navigating */
      }
    }

    const timer = setInterval(() => void poll(), 700)
    win.webContents.on('did-finish-load', () => void poll())
    win.on('closed', () => finish({ ok: false, error: 'Sign-in cancelled' }))
    void win.loadURL(`${base}/home`).catch((err: unknown) => {
      finish({ ok: false, error: `Could not open Rocket.Chat login page: ${String(err)}` })
    })
  })
}
