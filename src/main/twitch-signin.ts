import { browserLogin } from './browser-login'
import { log } from './log'

/**
 * Signing in to Twitch: one action that gives the account both things it needs.
 *
 * Twitch has two sign-ins that cannot be had from each other. Its official API (chat, sending, follows,
 * moderation) takes a token made by approving a short code on twitch.tv; its player takes only the session
 * of someone signed in to twitch.tv itself. Asking a person to do those as two flows was asking them to sign
 * in twice. Here it is one window: the person signs in to twitch.tv (typed there, never seen by moho), and
 * the same window, with the session it now holds, is taken to the page that approves the code. Approving it
 * is Twitch's own consent screen - what moho will be allowed to do is listed there - and is left to the
 * person; it is the one click that is theirs to make.
 *
 * The session found on the way goes straight to the daemon, to be saved with the account the code becomes,
 * and is never returned to the page that asked.
 */

type Request = (method: string, params: Record<string, unknown>) => Promise<unknown>

interface Waiting {
  loginId: string
  userCode: string
  gotCode: ((uri: string) => void) | null
  codePromise: Promise<string>
  result: ((r: { success: boolean; error?: string }) => void) | null
  resultPromise: Promise<{ success: boolean; error?: string }>
  /** The code was approved or the sign-in is over: the window may go where it likes. */
  finished: boolean
}

let active: Waiting | null = null

/** Daemon events, offered here by main for the sign-in that is waiting on them. */
export function feedTwitchSignIn(frame: { event: string; data?: Record<string, unknown> }): void {
  if (!active || !frame.event.startsWith('twitchLogin')) return
  const d = frame.data ?? {}
  // The first events can be heard before the daemon's answer naming the sign-in; nothing else is signing in.
  if (active.loginId && d.loginId !== active.loginId) return
  if (frame.event === 'twitchLoginCode' && typeof d.verificationUri === 'string') {
    if (typeof d.userCode === 'string') active.userCode = d.userCode
    active.gotCode?.(d.verificationUri)
  } else if (frame.event === 'twitchLoginResult') {
    active.result?.({ success: d.success === true, error: typeof d.error === 'string' ? d.error : undefined })
  }
}

export interface SignInOutcome {
  ok: boolean
  error?: string
}

export async function twitchSignIn(request: Request, options: { useTor?: boolean }): Promise<SignInOutcome> {
  if (active) return { ok: false, error: 'A Twitch sign-in is already under way' }
  let gotCode: (uri: string) => void = () => {}
  let result: (r: { success: boolean; error?: string }) => void = () => {}
  const w: Waiting = {
    loginId: '',
    userCode: '',
    gotCode: null,
    codePromise: new Promise<string>((r) => (gotCode = r)),
    result: null,
    finished: false,
    resultPromise: new Promise((r) => (result = r))
  }
  w.gotCode = gotCode
  w.result = result
  active = w
  try {
    const started = (await request('startTwitchLogin', {
      ...(typeof options.useTor === 'boolean' ? { useTor: options.useTor } : {})
    })) as { loginId: string }
    w.loginId = started.loginId

    const outcome = await browserLogin('twitch', {
      trace: (m) => log.info(`twitch sign-in: ${m}`),
      hold: async (token, win) => {
        // To the daemon, for the account the code is about to become. Never anywhere else.
        await request('setTwitchLoginWebToken', { loginId: w.loginId, token })
        let giveUp: NodeJS.Timeout | undefined
        const uri = await Promise.race([
          w.codePromise,
          new Promise<string>((_, no) => (giveUp = setTimeout(() => no(new Error('Twitch sent no code')), 30_000)))
        ]).finally(() => clearTimeout(giveUp))
        // Signed in. The page is still on its way somewhere (twitch.tv sends a new login to its front page), so
        // that is let finish before the same window is taken to the page that approves the code - and brought
        // back to it if the site's own redirect lands after, which would leave the person on the front page.
        await settled(win)
        const go = (): void => {
          log.info('twitch sign-in: taking the window to the approval page')
          win.loadURL(uri).catch(() => undefined)
        }
        go()
        let tries = 0
        const wander = (_e: unknown, url: string): void => {
          let here = ''
          try {
            here = new URL(url).pathname
          } catch {
            return
          }
          if (!here.startsWith('/activate') && !w.finished && tries < 4) {
            tries++
            log.info(`twitch sign-in: the window went to ${here}; back to the approval page (${tries})`)
            setTimeout(go, 600)
          }
        }
        // Twitch's page does not take the code from the address, so it is typed into the page's field for the
        // person, and nothing more: pressing Activate and then Authorize on Twitch's own screens is theirs.
        const filled = (): void => {
          if (w.finished || !w.userCode || !win.webContents.getURL().includes('/activate')) return
          void win.webContents
            .executeJavaScript(fillCode(w.userCode), true)
            .then((how: unknown) => log.info(`twitch sign-in: the code field: ${String(how)}`))
            .catch(() => undefined)
        }
        win.webContents.on('did-finish-load', filled)
        win.webContents.on('did-navigate', wander)
        win.webContents.on('did-navigate-in-page', wander)
        const done = await w.resultPromise
        w.finished = true
        if (!done.success) throw new Error(done.error || 'Twitch sign-in failed')
      }
    })
    if (!outcome.ok) {
      // The window was closed or timed out before the code was approved: nobody is waiting for it any more.
      await request('cancelTwitchLogin', { loginId: w.loginId }).catch(() => undefined)
      return { ok: false, error: outcome.error }
    }
    return { ok: true }
  } catch (e) {
    if (w.loginId) await request('cancelTwitchLogin', { loginId: w.loginId }).catch(() => undefined)
    return { ok: false, error: (e as Error).message }
  } finally {
    active = null
  }
}

/** Waits for the window's page to finish loading and stay quiet for a moment. */
async function settled(win: { webContents: { isLoading(): boolean } }): Promise<void> {
  const quiet = 1500
  let quietFor = 0
  for (let waited = 0; waited < 15_000 && quietFor < quiet; waited += 250) {
    await new Promise((r) => setTimeout(r, 250))
    quietFor = win.webContents.isLoading() ? 0 : quietFor + 250
  }
}

/**
 * A script that finds the code field on Twitch's "Activate your device" page and types the code in, the way a
 * person would (so the page's own scripts see it). Waits for the page, which draws it after it loads; says what it
 * found. It presses the page's Activate button, which only submits the code, and nothing after it.
 */
export function fillCode(code: string): string {
  return `(async (code) => {
    const type = (el, v) => {
      const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
      el.focus()
      set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const shown = (el) => el.getClientRects().length > 0 && !el.disabled && !el.readOnly
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      const inputs = [...document.querySelectorAll('input')].filter((i) => ['text', 'tel', 'search', ''].includes(i.type) && shown(i))
      const boxes = inputs.filter((i) => i.maxLength === 1)
      if (boxes.length >= code.length) {
        code.split('').forEach((c, i) => type(boxes[i], c))
        return 'filled ' + code.length + ' boxes'
      }
      const named = inputs.find((i) => /code/i.test([i.name, i.id, i.placeholder, i.getAttribute('aria-label')].join(' ')))
      const field = named || (inputs.length === 1 ? inputs[0] : null)
      if (field) {
        if (field.value !== code) type(field, code)
        // Submitting the code is the page's own "Activate" button; approving what moho may do, next, is not.
        const go = field.form && [...field.form.querySelectorAll('button, input[type=submit]')].find((b) => /^activate$/i.test((b.innerText || b.value || '').trim()))
        if (go && !window.__mohoSubmitted) {
          window.__mohoSubmitted = true
          go.click()
          return 'filled one field and pressed Activate'
        }
        return 'filled one field'
      }
      await new Promise((r) => setTimeout(r, 400))
    }
    return 'no code field found'
  })(${JSON.stringify(code)})`
}
