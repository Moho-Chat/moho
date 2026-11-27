import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {}, session: {} }))
vi.mock('./tunnel', () => ({ routeSession: async () => undefined }))

import { firefoxUserAgent, LOGIN_FLOWS, plainUserAgent } from './browser-login'

describe('the Google sign-in window', () => {
  it('presents itself as the Chromium it is', () => {
    const electron =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) moho/1.6.0 Chrome/146.0.7680.65 Electron/41.0.2 Safari/537.36'
    expect(plainUserAgent(electron)).toBe(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.65 Safari/537.36'
    )
  })

  it('says Firefox on each platform the way Firefox does', () => {
    expect(firefoxUserAgent('linux')).toMatch(/^Mozilla\/5\.0 \(X11; Linux x86_64; rv:(\d+\.0)\) Gecko\/20100101 Firefox\/\1$/)
    expect(firefoxUserAgent('win32')).toContain('(Windows NT 10.0; Win64; x64; rv:')
    expect(firefoxUserAgent('darwin')).toContain('(Macintosh; Intel Mac OS X 10.15; rv:')
  })

  it('takes the session only from the signed-in web app, and hands it to the daemon with the user agent', () => {
    const flow = LOGIN_FLOWS.googlechat
    expect(flow.userAgent).toBe('firefox')
    expect(flow.capture.kind).toBe('cookies')
    expect(flow.finish).toEqual({ method: 'addGoogleChatAccount', param: 'cookies' })
    expect(flow.alsoRead?.param).toBe('userAgent')
    if (flow.capture.kind !== 'cookies') return
    expect(flow.capture.signedIn).toContain("location.hostname === 'chat.google.com'")
    expect(flow.capture.signedIn).toContain('AccountsSignInUi')
  })
})
