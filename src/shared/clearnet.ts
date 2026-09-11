/**
 * The forum's hidden service, and the address of the same site on the open
 * internet.
 *
 * Links to the onion are ordinary in that chat - people copy them out of the
 * browser they are reading in - and unopenable for anybody who is not already
 * in Tor Browser. The two addresses are one site, so showing the reader the
 * one their browser can actually reach costs nothing and saves an errand.
 *
 * Shared between the window and the main process because both ends of a link
 * need it: the window draws the address, and the main process is what hands a
 * click to the operating system. A picture fetched from the site arrives
 * carrying an onion URL of its own, which never passes through the message
 * body and would otherwise still open into nothing.
 *
 * Deliberately not in the daemon. It goes on speaking to the onion through its
 * own Tor client, which is the point of having one; this is about what the
 * machine holding the browser can reach.
 */
export const KIWIFARMS_ONION = 'kiwifarmsaaf4t2h7gc3dfc5ojhmqruw2nit3uejrpiagrxeuxiyxcyd.onion'
export const KIWIFARMS_CLEARNET = 'https://kiwifarms.st'

const ONION_RE = new RegExp(`(?:https?:\\/\\/)?(?:www\\.)?${KIWIFARMS_ONION}`, 'gi')

/**
 * Rewrites the forum's onion address to its clearnet one, wherever it appears.
 *
 * Applied to a message on the way to being drawn rather than to the message as
 * it is stored, so it holds for a line edited after it was sent, for backlog
 * fetched before this existed, and for a quote of either - the rewrite is part
 * of drawing the text, and drawing happens again every time.
 *
 * A mention with no scheme in front of it gains one, since the result is a
 * real address and a linkifier only knows a link by its scheme. Everything
 * after the host - the path, the query, the fragment - is left exactly as it
 * was, because that is the part naming the thread being pointed at.
 */
export function clearnetLinks(text: string): string {
  if (!text) return text
  return text.replace(ONION_RE, KIWIFARMS_CLEARNET)
}
