import { BrowserWindow, session } from 'electron'

/**
 * Answering the captcha Discord asks for, in a window of moho's own.
 *
 * Discord refuses some actions - adding a friend, joining a server - from
 * anything it scores as automated, and says so by naming an hCaptcha
 * challenge rather than by saying no. Answered, the same request goes
 * through. Until now moho had nowhere to put that challenge, so those actions
 * were sent off to discord.com in a browser and the client was a companion to
 * Discord rather than a way of using it.
 *
 * # Why this is a window and not a panel
 *
 * The widget is bound to the site it belongs to, and the token records where
 * it was solved. So the page holding it has to genuinely be on discord.com -
 * which moho's own renderer is not, and should not become: admitting
 * hcaptcha.com's script into the page that holds the bridge to the daemon
 * would put a third-party blob in the most privileged place in the app.
 *
 * A window loading a real discord.com page has neither problem. The origin is
 * theirs because the page is theirs, nothing is being spoofed, and the widget
 * runs in a sandboxed renderer that can reach nothing of moho's. Discord's own
 * CSP names `hcaptcha.com` in `script-src`, `connect-src` and `frame-src`,
 * because rendering this widget on this origin is exactly what Discord's own
 * client does.
 *
 * What it is *not* is a browser session. Nothing is signed into, nothing is
 * navigated, and the partition is thrown away with the window: it is one
 * checkbox, and the account's own token never comes near it - the answer goes
 * back to the daemon, which repeats the request it already knew how to make.
 */

/**
 * A discord.com page to host the widget - any of them would do, since only
 * the origin matters. The 404 is the cheapest one that still carries the CSP.
 *
 * Its own scripts are stopped the moment the document exists (see below), so
 * the app behind it never boots.
 */
const HOST_PAGE = 'https://discord.com/404'

/** hCaptcha's own loader, from the host Discord's CSP admits. */
const WIDGET_API = 'https://js.hcaptcha.com/1/api.js?render=explicit&onload=__mohoCaptchaReady'

/** Long enough to read a set of pictures, and to be handed a second set. */
const TIMEOUT_MS = 3 * 60 * 1000

export interface CaptchaRequest {
  /** The site the challenge belongs to, as Discord named it. */
  sitekey: string
  /**
   * hCaptcha's enterprise binding, tying this challenge to this account and
   * this action. Passed to the widget verbatim; without it the right answer
   * to the right puzzle is still refused.
   */
  rqdata?: string | null
}

export interface CaptchaOutcome {
  ok: boolean
  /** The solved token, to be handed straight back to the daemon. */
  token?: string
  /** Why there is no token - including "cancelled", which is a choice. */
  error?: string
}

let openWindow: BrowserWindow | null = null

/**
 * Puts the challenge on screen and resolves with what it produces.
 *
 * One at a time: two challenges racing would leave somebody answering a
 * puzzle without knowing which action it was for.
 */
export async function solveCaptcha(
  request: CaptchaRequest,
  parent?: BrowserWindow
): Promise<CaptchaOutcome> {
  if (!request?.sitekey) return { ok: false, error: 'Discord asked for a captcha but named no site key' }
  if (openWindow && !openWindow.isDestroyed()) {
    openWindow.focus()
    return { ok: false, error: 'A captcha is already open' }
  }

  // Memory-only, like the sign-in windows: nothing here is worth keeping, and
  // a challenge answered is a challenge over.
  const partition = `moho-captcha-${Date.now()}`
  const ses = session.fromPartition(partition)

  const win = new BrowserWindow({
    width: 420,
    height: 560,
    parent,
    modal: !!parent,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Discord asked for a captcha',
    autoHideMenuBar: true,
    backgroundColor: '#101418',
    show: false,
    webPreferences: {
      partition,
      // Untrusted third-party content, in its own renderer: no preload, no
      // node, nothing of moho's within reach.
      preload: undefined,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })
  openWindow = win

  // The page is a host for the widget, not a page to read - and it must not
  // be able to claim to be something else. Discord's own title is suppressed
  // and the host is shown, the same rule the sign-in windows follow.
  win.on('page-title-updated', (e) => {
    e.preventDefault()
  })

  return await new Promise<CaptchaOutcome>((resolve) => {
    let settled = false
    const finish = (outcome: CaptchaOutcome): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!win.isDestroyed()) win.destroy()
      openWindow = null
      void ses.clearStorageData()
      resolve(outcome)
    }

    const timer = setTimeout(() => finish({ ok: false, error: 'Timed out waiting for the captcha' }), TIMEOUT_MS)

    // Closing it is a decision rather than a failure, so the caller can go
    // quiet instead of showing an error nobody caused.
    win.on('closed', () => finish({ ok: false, error: 'cancelled' }))

    // The token comes back as a navigation the page makes to a scheme nothing
    // can follow, which is the one channel a sandboxed renderer with no
    // preload has to a parent that is listening. Reading it here rather than
    // polling means the window closes the instant the box is ticked.
    win.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith('moho-captcha:')) return
      e.preventDefault()
      const token = decodeURIComponent(url.slice('moho-captcha:'.length))
      if (token === 'error') {
        finish({ ok: false, error: 'The captcha could not be loaded. Trying again usually works.' })
        return
      }
      finish({ ok: true, token })
    })

    // Set the moment the document exists, which is also the moment its own
    // load is deliberately stopped. Without it, that stop arrives back as a
    // failed navigation and is reported as "could not reach Discord" - the
    // one error message guaranteed to be wrong, since the page is right there.
    let arrived = false

    win.webContents.once('dom-ready', () => {
      arrived = true
      // Discord's own page stops here. Only its origin was ever wanted, and
      // letting the client boot would mean loading megabytes to show a
      // checkbox - and a running app underneath the thing being answered.
      win.webContents.stop()
      win.webContents
        .executeJavaScript(widgetPage(request), true)
        .then(() => {
          if (!win.isDestroyed()) win.show()
        })
        .catch((e: Error) => finish({ ok: false, error: `Could not show the captcha: ${e.message}` }))
    })

    win.loadURL(HOST_PAGE).catch((e: Error) => {
      if (arrived) return
      finish({ ok: false, error: `Could not reach Discord to show the captcha: ${e.message}` })
    })
  })
}

/**
 * The page the widget is rendered into, as a script run on Discord's origin.
 *
 * Written as an injection rather than loaded from a file because a file of
 * ours would be a file of ours - a different origin, which is the one thing
 * this whole arrangement exists to get right.
 */
function widgetPage(request: CaptchaRequest): string {
  const sitekey = JSON.stringify(request.sitekey)
  const rqdata = JSON.stringify(request.rqdata ?? null)
  return `(() => {
    document.documentElement.innerHTML =
      '<head><meta charset="utf-8"><title>Captcha</title></head>' +
      '<body style="margin:0;background:#101418;color:#dbdee1;' +
      'font:14px system-ui,sans-serif;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;height:100vh;gap:14px">' +
      '<p style="margin:0;max-width:320px;text-align:center;color:#b5bac1">' +
      'Discord wants to know you are a person before it does this.</p>' +
      '<div id="moho-captcha"></div>' +
      '<p id="moho-state" style="margin:0;font-size:12px;color:#80848e">Loading…</p></body>'

    const say = (text) => {
      const el = document.getElementById('moho-state')
      if (el) el.textContent = text
    }
    const done = (value) => { location.href = 'moho-captcha:' + encodeURIComponent(value) }

    window.__mohoCaptchaReady = () => {
      say('Tick the box to carry on.')
      try {
        hcaptcha.render('moho-captcha', {
          sitekey: ${sitekey},
          theme: 'dark',
          ...(${rqdata} ? { rqdata: ${rqdata} } : {}),
          callback: done,
          'error-callback': () => done('error'),
          // A challenge that runs out is not a failure to report: it is asked
          // again, which is what the widget does on its own once told.
          'expired-callback': () => say('That one expired - tick the box again.')
        })
      } catch (e) {
        done('error')
      }
    }

    const script = document.createElement('script')
    script.src = ${JSON.stringify(WIDGET_API)}
    script.onerror = () => done('error')
    document.head.appendChild(script)
  })()`
}
