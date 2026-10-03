import { protocol, session } from 'electron'
import { log } from './log'

/**
 * Remote media for a strictly routed account, fetched through its route.
 *
 * An account's routing has three positions (#257). The first two only decide
 * how the daemon reaches the service; everything the window loads for itself
 * - pictures and video linked in a message, avatars, emoji, embeds, the link
 * check that decides whether a URL is a picture - is Chromium's, and goes out
 * directly from the user's own address. For an account on Tor that is the
 * leak routing it was meant to prevent: anybody in the channel can post a link
 * to a server of theirs and learn the reader's IP the moment it arrives.
 *
 * Strict closes it. The window rewrites every remote URL it loads for such an
 * account to `moho-routed://fetch/?u=<url>`, and this handler fetches it
 * through a session of its own, pointed at the daemon's route: moho's Tor, or
 * the proxy the user named. Hostnames go to the proxy unresolved, so the
 * lookup does not leak either.
 *
 * Fails closed. With no route yet - Tor still starting, a proxy not answering
 * - the answer is an error and the picture does not draw, rather than being
 * fetched directly.
 */

export const ROUTED_SCHEME = 'moho-routed'

type Request = (method: string, params?: Record<string, unknown>) => Promise<unknown>

/** Only what a picture, a video or a link check needs to read. */
const PASSED_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'cache-control',
  'last-modified',
  'etag'
]

let configured = false
let configuring: Promise<boolean> | null = null
let ask: Request | null = null

/** In memory only: nothing it is sent is kept, and it holds no cookies. */
function routedSession(): Electron.Session {
  return session.fromPartition(ROUTED_SCHEME)
}

/** Points the session at the route, once, and again after a change. */
function ensureRoute(): Promise<boolean> {
  if (configured) return Promise.resolve(true)
  if (configuring) return configuring
  configuring = (async () => {
    try {
      if (!ask) return false
      const answer = (await ask('netRoute')) as { socks?: string }
      if (!answer?.socks) return false
      await routedSession().setProxy({ proxyRules: `socks5://${answer.socks}` })
      configured = true
      log.info(`routed: strict media through ${answer.socks}`)
      return true
    } catch (e) {
      log.warn(`routed: no route for strict media, holding it back: ${(e as Error).message}`)
      return false
    } finally {
      configuring = null
    }
  })()
  return configuring
}

/** The route may have moved - Tor restarted, a proxy changed. Asked afresh. */
export function resetRoute(): void {
  configured = false
}

export function installRoutedHandler(request: Request): void {
  ask = request
  protocol.handle(ROUTED_SCHEME, async (req) => {
    const target = new URL(req.url).searchParams.get('u') ?? ''
    // Web addresses only. Anything else is not a thing to fetch on the
    // network's behalf, and a local path has its own, guarded scheme.
    if (!/^https?:\/\//i.test(target)) return new Response('bad request', { status: 400 })
    if (!(await ensureRoute())) return new Response('no route', { status: 502 })
    try {
      const headers = new Headers()
      const range = req.headers.get('range')
      if (range) headers.set('range', range)
      const res = await routedSession().fetch(target, {
        method: req.method === 'HEAD' ? 'HEAD' : 'GET',
        headers,
        credentials: 'omit',
        redirect: 'follow'
      })
      const out = new Headers()
      for (const name of PASSED_HEADERS) {
        const value = res.headers.get(name)
        if (value) out.set(name, value)
      }
      // Readable by the page as well as drawable, as the media scheme is: the
      // link check reads the content type.
      out.set('Access-Control-Allow-Origin', '*')
      return new Response(req.method === 'HEAD' ? null : res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: out
      })
    } catch (e) {
      // A dead route looks like this too; ask again next time.
      configured = false
      log.warn(`routed: fetching through the route failed: ${(e as Error).message}`)
      return new Response('route failed', { status: 502 })
    }
  })
}
