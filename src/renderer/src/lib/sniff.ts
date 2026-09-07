import { useCallback, useSyncExternalStore } from 'react'

/**
 * Content-Type probing for links that extension- and host-based detection
 * can't classify. Gated on the "Embed unrecognized links by content type"
 * preference, which defaults on despite the trade-off:
 *
 * this is a plain HTTP request straight from the renderer, not routed through
 * nobilis or (for Sneedchat) its embedded Tor client. It reveals a connection to
 * whatever was linked the moment a message arrives, whether or not the link is
 * ever clicked. Users who care turn it off in Settings.
 *
 * Results are shared across every message row rather than probed per-row, so
 * the same link appearing twice - or scrolling back into view - never repeats
 * a request that's already answered.
 */

export type SniffKind = 'image' | 'video' | 'none'

/**
 * How many answers to keep.
 *
 * This is a cache, and it used to be a list: one entry per link ever seen,
 * held for the life of the window, copied in full on every new answer. A
 * session that had read a few busy channels was carrying tens of thousands of
 * URLs to save a request it was never going to make again. The oldest go
 * first, which for a chat log is the ones furthest up the scroll.
 */
const MAX_REMEMBERED = 500

const resolved: Record<string, SniffKind> = {}
const inFlight = new Set<string>()
const listeners = new Set<() => void>()

/** Replaced wholesale on each answer so selectors see a new reference. */
let snapshot: Record<string, SniffKind> = resolved

function notify(): void {
  snapshot = { ...resolved }
  for (const l of listeners) l()
}

export function sniffUrl(url: string): void {
  if (resolved[url] !== undefined || inFlight.has(url)) return
  inFlight.add(url)

  const finish = (kind: SniffKind): void => {
    inFlight.delete(url)
    resolved[url] = kind
    // Insertion order is the age order here, and a plain object keeps it for
    // string keys that are not array indices - which a URL never is.
    const keys = Object.keys(resolved)
    for (let i = 0; i < keys.length - MAX_REMEMBERED; i++) delete resolved[keys[i]]
    notify()
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)

  // HEAD rather than GET: the Content-Type header is the whole answer, and a
  // GET would pull the entire body of something that may not even be media.
  fetch(url, { method: 'HEAD', signal: controller.signal })
    .then((res) => {
      const contentType = res.headers.get('content-type') || ''
      if (contentType.startsWith('image/')) finish('image')
      else if (contentType.startsWith('video/')) finish('video')
      else finish('none')
    })
    .catch(() => finish('none'))
    .finally(() => clearTimeout(timer))
}

export function useSniffedTypes(): Record<string, SniffKind> {
  return useSyncExternalStore(
    useCallback((listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }, []),
    () => snapshot
  )
}
