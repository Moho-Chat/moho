import { BrowserWindow, session } from 'electron'
import { routeSession } from './tunnel'

/**
 * An integrity token for Twitch's GraphQL, which only a real page on twitch.tv can make.
 *
 * Twitch asks, now and then, for proof that the one asking for a stream is a browser and not a program: a
 * token its own page computes with bot-detection script that nobody else can run. Not asked for today, and
 * for a week in May 2023 it was. When it is asked for again the daemon cannot make one, so it says so (the
 * `twitchIntegrityNeeded` event) and this makes it: a window nobody sees, on a throwaway session, that loads
 * a twitch.tv page, waits for that script to be ready, and calls the same endpoint the page does. The token
 * comes back valid for about sixteen hours and is for the device id the daemon names.
 *
 * Nothing is signed in to, nothing is kept (the session is memory-only and wiped), and it goes through the
 * route like every other window does.
 */

/** The Client ID twitch.tv's own pages send; the integrity endpoint answers only to it. */
const SITE_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'

export interface Integrity {
  token: string
  /** When it stops being good, in Unix milliseconds. */
  expiration: number
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function mintIntegrity(deviceId: string, authToken = '', timeoutMs = 45_000): Promise<Integrity> {
  const partition = `moho-twitch-integrity-${Date.now()}`
  const ses = session.fromPartition(partition)
  await routeSession(ses)
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
  })
  try {
    // A page with Twitch's own scripts on it: the bot check is one of them, and it patches fetch.
    await win.loadURL('https://www.twitch.tv/directory')
    const script = `(async () => {
      const r = await fetch('https://gql.twitch.tv/integrity', { method: 'POST', headers: { 'Client-ID': ${JSON.stringify(SITE_CLIENT_ID)}, 'X-Device-Id': ${JSON.stringify(deviceId)}${authToken ? `, Authorization: ${JSON.stringify('OAuth ' + authToken)}` : ''} }, credentials: 'omit' })
      if (r.status !== 200) throw new Error('Twitch answered ' + r.status)
      const j = await r.json()
      if (!j.token) throw new Error('Twitch sent no token')
      return { token: j.token, expiration: j.expiration }
    })()`
    const deadline = Date.now() + timeoutMs
    let last = ''
    // The script that makes the call valid loads after the page does, so the first tries may be refused.
    while (Date.now() < deadline) {
      try {
        const made = (await win.webContents.executeJavaScript(script, true)) as Integrity
        if (made?.token) return made
      } catch (e) {
        last = (e as Error).message
      }
      await sleep(2000)
    }
    throw new Error(last || 'the page never became ready')
  } finally {
    if (!win.isDestroyed()) win.destroy()
    void ses.clearStorageData()
  }
}

/** Answers the daemon's request: makes the token and hands it over, or says why it could not. */
export async function answerIntegrity(
  data: { requestId?: string; deviceId?: string; authToken?: string },
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>
): Promise<void> {
  if (!data.requestId || !data.deviceId) return
  try {
    // As the account when it names one: Twitch takes for an account's call only a token made as that account.
    const made = await mintIntegrity(data.deviceId, data.authToken ?? '')
    await request('provideTwitchIntegrity', { requestId: data.requestId, token: made.token, expiration: made.expiration })
  } catch (e) {
    await request('provideTwitchIntegrity', { requestId: data.requestId, error: (e as Error).message }).catch(() => {})
  }
}
