import { beforeEach, describe, expect, it, vi } from 'vitest'

// The window itself is Electron's; what is under test is the order of things around it.
const login = vi.hoisted(() => ({ browserLogin: vi.fn() }))
vi.mock('./browser-login', () => login)

import { feedTwitchSignIn, twitchSignIn } from './twitch-signin'

describe('Twitch sign-in as one action', () => {
  beforeEach(() => {
    login.browserLogin.mockReset()
  })

  it('hands the session to the daemon, takes the same window to the code, and finishes when the code is approved', async () => {
    const calls: string[] = []
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push(method)
      if (method === 'startTwitchLogin') {
        // The code is heard in the time it takes the person to sign in.
        setTimeout(() => feedTwitchSignIn({ event: 'twitchLoginCode', data: { loginId: 'L1', verificationUri: 'https://www.twitch.tv/activate?device-code=ABCD' } }), 0)
        return { loginId: 'L1' }
      }
      if (method === 'setTwitchLoginWebToken') expect(params).toEqual({ loginId: 'L1', token: 'web-session' })
      return {}
    })
    const loaded: string[] = []
    login.browserLogin.mockImplementation(async (_service: string, options: { hold: (v: string, w: unknown) => Promise<void> }) => {
      const win = { loadURL: async (u: string) => void loaded.push(u) }
      const held = options.hold('web-session', win)
      // Approving it on the page.
      setTimeout(() => feedTwitchSignIn({ event: 'twitchLoginResult', data: { loginId: 'L1', success: true } }), 20)
      await held
      return { ok: true }
    })
    const outcome = await twitchSignIn(request, { moderation: true })
    expect(outcome).toEqual({ ok: true })
    expect(calls).toEqual(['startTwitchLogin', 'setTwitchLoginWebToken'])
    expect(loaded).toEqual(['https://www.twitch.tv/activate?device-code=ABCD'])
    expect(request).toHaveBeenCalledWith('startTwitchLogin', { moderation: true })
  })

  it('ends the daemon\'s wait when the window is closed before the code was approved', async () => {
    const calls: string[] = []
    const request = vi.fn(async (method: string) => {
      calls.push(method)
      return method === 'startTwitchLogin' ? { loginId: 'L2' } : {}
    })
    login.browserLogin.mockResolvedValue({ ok: false, error: 'cancelled' })
    expect(await twitchSignIn(request, {})).toEqual({ ok: false, error: 'cancelled' })
    expect(calls).toEqual(['startTwitchLogin', 'cancelTwitchLogin'])
  })

  it('does not run two at once, and says a refused sign-in', async () => {
    let release: (v: { ok: boolean }) => void = () => {}
    login.browserLogin.mockImplementation(() => new Promise((r) => (release = r)))
    const request = vi.fn(async () => ({ loginId: 'L3' }))
    const first = twitchSignIn(request, {})
    await new Promise((r) => setTimeout(r, 5))
    expect(await twitchSignIn(request, {})).toEqual({ ok: false, error: 'A Twitch sign-in is already under way' })
    release({ ok: true })
    await first
  })
})
