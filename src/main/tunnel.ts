import { session, webContents, type Session } from 'electron'
import { log } from './log'

/**
 * The window's own traffic, through Tor or the SOCKS5 proxy, when the daemon
 * is set to tunnel everything.
 *
 * Everything the window fetches for itself - the HEAD request that decides
 * whether a link is a picture, link previews, every image and video it shows -
 * is Chromium's, not the daemon's, so the daemon's routing cannot reach it.
 * Chromium can be pointed at a SOCKS5 proxy, though, and the daemon offers one:
 * moho's own Tor through a relay on loopback, or the proxy somebody named. So
 * this asks the daemon where that is and points every session at it.
 *
 * Fails closed. When everything should be tunnelled and the daemon has no
 * address to give - Tor still starting, a proxy not answering - the sessions
 * are pointed at a port that refuses, so the window loads nothing rather than
 * loading it directly. Calls are held to the same rule: WebRTC may not use UDP
 * that does not go through the proxy, which in practice means no calls, since
 * neither Tor nor SOCKS5 carries UDP.
 */

let tunnelled = false
let rules: string | null = null
const extraSessions = new Set<Session>()

const REFUSING = 'socks5://127.0.0.1:9'

type Request = (method: string, params?: Record<string, unknown>) => Promise<unknown>

/** Asks the daemon, and applies the answer to every session and page. */
export async function applyTunnel(request: Request): Promise<void> {
  let answer: { tunnelAll?: boolean; socks?: string | null; error?: string }
  try {
    answer = (await request('netTunnel')) as typeof answer
  } catch (e) {
    // An older daemon, or none: keep whatever was in force.
    log.warn(`tunnel: could not ask the daemon: ${(e as Error).message}`)
    return
  }
  tunnelled = !!answer.tunnelAll
  rules = tunnelled ? (answer.socks ? `socks5://${answer.socks}` : REFUSING) : null
  if (tunnelled && !answer.socks) log.warn(`tunnel: no route yet, holding the window offline: ${answer.error ?? ''}`)
  else log.info(`tunnel: ${tunnelled ? `everything through ${answer.socks}` : 'direct'}`)
  await Promise.all([session.defaultSession, ...extraSessions].map(routeOne))
  for (const contents of webContents.getAllWebContents()) applyPolicy(contents)
}

/** Routes a session made later - a sign-in window's partition. */
export async function routeSession(ses: Session): Promise<void> {
  extraSessions.add(ses)
  await routeOne(ses)
}

/** The WebRTC rule for a page, as things stand. */
export function applyPolicy(contents: Electron.WebContents): void {
  try {
    contents.setWebRTCIPHandlingPolicy(tunnelled ? 'disable_non_proxied_udp' : 'default')
  } catch {
    // A page already gone.
  }
}

async function routeOne(ses: Session): Promise<void> {
  try {
    await ses.setProxy(rules ? { proxyRules: rules } : { mode: 'direct' })
    // Connections opened before the change would otherwise go on as they were.
    await ses.closeAllConnections()
  } catch (e) {
    log.warn(`tunnel: could not route a session: ${(e as Error).message}`)
  }
}
