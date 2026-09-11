/**
 * Asking a page which picture it is showing.
 *
 * An image host's "for forums" button hands out a thumbnail wrapped in a link
 * to a *page* - postimg.cc/abc123, not the file - and the page is where the
 * full-size image lives. Opening the thumbnail in the viewer therefore showed
 * the thumbnail: the only thing the message ever named was the small copy.
 *
 * Every one of these pages says what it is showing, in the same place, because
 * they all want a preview when they are pasted into a chat window: the
 * OpenGraph `og:image` tag. Reading it is how a link unfurls anywhere else,
 * and it needs no per-host knowledge - postimg, ibb, imgur and the rest all
 * answer the same question the same way.
 *
 * Asked only when somebody opens the picture, unlike the content-type probe in
 * `sniff.ts` which runs as a message arrives. That is the whole difference in
 * what it discloses: a click is a person deciding to look at the thing, and
 * the request goes to the host the message already named.
 *
 * The request itself is made by the main process - see `resolveImagePage`.
 * What lives here is the remembering, so that a picture opened twice is asked
 * about once.
 */

/** Answers already had, including the failures - see `asked`. */
const known: Record<string, string | null> = {}
const inFlight = new Map<string, Promise<string | null>>()

/**
 * How many answers to keep, oldest out first.
 *
 * The same ceiling and the same reason as the sniff cache: this is a cache,
 * not a record, and a session that has read a busy channel for a day should
 * not be holding every image page it ever saw.
 */
const MAX_REMEMBERED = 200

/** Not merely "no answer yet": a page that gave nothing is not asked twice. */
export function asked(pageUrl: string): boolean {
  return known[pageUrl] !== undefined
}

export function knownFullImage(pageUrl: string): string | null {
  return known[pageUrl] ?? null
}

export async function fullImageFor(pageUrl: string): Promise<string | null> {
  if (known[pageUrl] !== undefined) return known[pageUrl]
  const already = inFlight.get(pageUrl)
  if (already) return already

  // Asked of the main process: this document is a `file://` one, and a reply
  // from somebody else's host is not a reply it is allowed to read.
  const run = window.moho
    .resolveImagePage(pageUrl)
    .catch(() => null)
    .then((found) => {
      inFlight.delete(pageUrl)
      known[pageUrl] = found
      // Insertion order is age order for string keys that are not array
      // indices, which a URL never is - so the oldest go first.
      const keys = Object.keys(known)
      for (let i = 0; i < keys.length - MAX_REMEMBERED; i++) delete known[keys[i]]
      return found
    })

  inFlight.set(pageUrl, run)
  return run
}
