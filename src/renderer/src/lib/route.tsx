import { createContext, useCallback, useContext } from 'react'
import { useChat } from '../state/hooks'
import { resolveMediaUrl } from './util'
import { routedUrl } from './routedurl'

/**
 * Remote media for a strictly routed account goes through its route (#257).
 *
 * An account on Tor or a SOCKS5 proxy routes its connection, but anything the
 * window loads for its conversations - a linked picture, an avatar, an emoji,
 * the check that asks a link what it is - would otherwise go out straight
 * from the user's own address, and anybody who can post a link learns it.
 * At the "strict" level every such URL is rewritten to the main process's
 * `moho-routed` scheme, which fetches it through the route and fails closed.
 *
 * Everything else is unchanged: local files still go through the media
 * scheme, and with everything tunnelled the window is already routed whole.
 */

export { ROUTED_SCHEME, routedUrl } from './routedurl'

function isWeb(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/** The account whose conversation this is - set around a conversation, its
 *  member list and its profile cards, so what is nested in them needs no
 *  account passed down to it. */
export const RouteAccount = createContext<string | undefined>(undefined)

/** The account a buffer belongs to: buffer ids are `<account>|<name>`. */
export function accountOfBuffer(bufferId: string): string {
  const at = bufferId.indexOf('|')
  return at === -1 ? bufferId : bufferId.slice(0, at)
}

/** Whether this account's media must go through its route. */
export function useStrictRoute(accountId?: string): boolean {
  const fromContext = useContext(RouteAccount)
  const id = accountId ?? fromContext
  return useChat((s) => !s.tunnelAll && !!id && s.accounts.some((a) => a.id === id && a.routeLevel === 'strict'))
}

/**
 * The URL to load for a picture, a video or a sound in this account's
 * conversation: a local file through the media scheme, a web URL through the
 * route when the account is strict, and anything else as it is.
 */
export function useMediaUrl(accountId?: string): (url: string) => string {
  const strict = useStrictRoute(accountId)
  return useCallback(
    (url: string) => {
      if (!url) return url
      if (strict && isWeb(url)) return routedUrl(url)
      return resolveMediaUrl(url)
    },
    [strict]
  )
}
