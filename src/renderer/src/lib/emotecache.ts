/**
 * Small local copies of Kick emotes.
 *
 * Kick serves one size of an emote and it is the big one - typically 500x500,
 * animated, about a megabyte - while a picker cell draws it at 26 pixels and a
 * message smaller still. Decoded, a 35-frame emote is 33MB of frame buffers,
 * which is why opening the picker cost hundreds of megabytes (issue #211).
 *
 * The daemon keeps a shrunk copy of each emote it has been asked for, 64
 * pixels on the longest edge, animation intact: 33MB of frame buffers becomes
 * 0.55MB. This module is the renderer's half - a map of emote id to local
 * file, consulted whenever an emote URL is about to be used.
 *
 * It is deliberately synchronous. Emote URLs are built in two places that
 * cannot await: the HTML formatter, which returns a string, and the picker,
 * which renders a cell. So the map is filled in the background and read
 * without blocking, and an emote not in it yet falls back to Kick's own URL -
 * the right picture, just an expensive one, rather than a gap.
 */

/** Kick's own emote URL, which is the only shape worth rewriting. */
const KICK_EMOTE = /^https:\/\/files\.kick\.com\/emotes\/(\d+)\/fullsize$/

const local = new Map<string, string>()
/** Ids asked for but not yet answered, so nothing is requested twice. */
const pending = new Set<string>()
/** Ids seen but not yet requested, flushed together a tick later. */
const queued = new Set<string>()
let flushing: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

/** The emote id in a Kick emote URL, or null for anything else. */
export function kickEmoteId(url: string): string | null {
  return url.match(KICK_EMOTE)?.[1] ?? null
}

/** Told when new local copies land, so a view can draw them. */
export function onLocalEmotes(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function merge(map: Record<string, string>): void {
  let added = 0
  for (const [id, url] of Object.entries(map)) {
    if (!local.has(id)) added++
    local.set(id, url)
    pending.delete(id)
  }
  if (added > 0) for (const fn of listeners) fn()
}

/**
 * Everything the daemon already has, asked for once at startup.
 *
 * Without this every emote would be drawn full-size once per session before
 * its small copy was noticed - the cache is on disk and survives restarts, so
 * there is no reason to rediscover it a megabyte at a time.
 */
export async function loadLocalEmotes(): Promise<void> {
  try {
    merge(await window.moho.rpc<Record<string, string>>('kickEmotes', {}))
  } catch {
    /* an older daemon has no such method; emotes stay full-size */
  }
}

/** Ask for these emotes to be shrunk, batched so a screenful is one call. */
export function requestLocalEmotes(ids: string[]): void {
  for (const id of ids) {
    if (!local.has(id) && !pending.has(id)) queued.add(id)
  }
  if (queued.size === 0 || flushing) return
  flushing = setTimeout(async () => {
    flushing = null
    const batch = [...queued]
    queued.clear()
    for (const id of batch) pending.add(id)
    try {
      merge(await window.moho.rpc<Record<string, string>>('kickEmotes', { ids: batch }))
    } catch {
      for (const id of batch) pending.delete(id)
    }
  }, 50)
}

/**
 * The URL to actually draw for an emote: the small local copy where there is
 * one, and Kick's own otherwise - with the small one requested for next time.
 *
 * Takes and returns a URL rather than an id so that both callers can use it
 * without agreeing on what an emote's id means: the formatter builds the URL
 * from a token, the picker is handed one by the daemon, and the only thing
 * they share is the URL's shape.
 */
export function drawableEmoteUrl(url: string): string {
  const id = kickEmoteId(url)
  if (!id) return url
  const small = local.get(id)
  if (small) return small
  requestLocalEmotes([id])
  return url
}

/** Test seam: forget everything, so one test cannot colour the next. */
export function resetLocalEmotes(): void {
  local.clear()
  pending.clear()
  queued.clear()
}
