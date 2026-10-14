import { browserLogin } from './browser-login'

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
  code?: { verificationUri: string }
  gotCode: ((uri: string) => void) | null
  codePromise: Promise<string>
  result: ((r: { success: boolean; error?: string }) => void) | null
  resultPromise: Promise<{ success: boolean; error?: string }>
}

let active: Waiting | null = null

/** Daemon events, offered here by main for the sign-in that is waiting on them. */
export function feedTwitchSignIn(frame: { event: string; data?: Record<string, unknown> }): void {
  if (!active || !frame.event.startsWith('twitchLogin')) return
  const d = frame.data ?? {}
  // The first events can be heard before the daemon's answer naming the sign-in; nothing else is signing in.
  if (active.loginId && d.loginId !== active.loginId) return
  if (frame.event === 'twitchLoginCode' && typeof d.verificationUri === 'string') {
    active.gotCode?.(d.verificationUri)
  } else if (frame.event === 'twitchLoginResult') {
    active.result?.({ success: d.success === true, error: typeof d.error === 'string' ? d.error : undefined })
  }
}

export interface SignInOutcome {
  ok: boolean
  error?: string
}

export async function twitchSignIn(request: Request, options: { useTor?: boolean; moderation?: boolean }): Promise<SignInOutcome> {
  if (active) return { ok: false, error: 'A Twitch sign-in is already under way' }
  let gotCode: (uri: string) => void = () => {}
  let result: (r: { success: boolean; error?: string }) => void = () => {}
  const w: Waiting = {
    loginId: '',
    gotCode: null,
    codePromise: new Promise<string>((r) => (gotCode = r)),
    result: null,
    resultPromise: new Promise((r) => (result = r))
  }
  w.gotCode = gotCode
  w.result = result
  active = w
  try {
    const started = (await request('startTwitchLogin', {
      ...(typeof options.useTor === 'boolean' ? { useTor: options.useTor } : {}),
      moderation: options.moderation === true
    })) as { loginId: string }
    w.loginId = started.loginId

    const outcome = await browserLogin('twitch', {
      hold: async (token, win) => {
        // To the daemon, for the account the code is about to become. Never anywhere else.
        await request('setTwitchLoginWebToken', { loginId: w.loginId, token })
        let giveUp: NodeJS.Timeout | undefined
        const uri = await Promise.race([
          w.codePromise,
          new Promise<string>((_, no) => (giveUp = setTimeout(() => no(new Error('Twitch sent no code')), 30_000)))
        ]).finally(() => clearTimeout(giveUp))
        // Signed in: the same window goes to the page that approves the code, with the code already in it.
        await win.loadURL(uri)
        const done = await w.resultPromise
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
