/**
 * The main process's scheme for remote media fetched through an account's
 * route (#257) - see main/routed.ts and lib/route.tsx. Kept apart from the
 * React side so plain modules (the link check, the emote cache) can use it.
 */
export const ROUTED_SCHEME = 'moho-routed'

/** A web URL, fetched through the route instead of directly. */
export function routedUrl(url: string): string {
  return `${ROUTED_SCHEME}://fetch/?u=${encodeURIComponent(url)}`
}
