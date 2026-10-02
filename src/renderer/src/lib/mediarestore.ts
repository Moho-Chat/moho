import { resolveMediaUrl } from './util'

/**
 * Pictures whose cached copy has gone, fetched again.
 *
 * The daemon keeps every picture it fetched for the window - avatars,
 * attachments, thumbnails - in caches it holds to a size and an age, and
 * Settings can empty them. Scrollback still names the files, so without this
 * a picture that expired was a broken box in history for good. Now a picture
 * that fails to load is handed back to the daemon, which fetches it again
 * from where it came from (see nobilis's media_cache.rs), and the picture is
 * loaded again from the answer.
 *
 * One listener on the document rather than one per picture, for the reason
 * the emote recovery gives: pictures are drawn by React and by an HTML
 * formatter alike, and `error` does not bubble but can be caught on its way
 * down. Caught there, it is held back from the element's own handler until
 * the daemon has answered - a picture that comes back never shows its
 * failure, and one that cannot is let through to fail as it always did.
 */

/** The caches the daemon can restore from, by folder. Kick's emotes are
 *  not here: lib/emotecache puts Kick's own picture up at once instead. */
const RESTORABLE = /[\\/]nobilis[\\/](matrix-media|sneedchat-attachments|sneedchat-avatars|discord-thumbnails|discord-icons)[\\/]/

/** Paths being fetched, so a picture drawn twice asks once. */
const inFlight = new Map<string, Promise<string | null>>()
/** Paths the daemon could not bring back this session. */
const gone = new Set<string>()

type Media = HTMLImageElement | HTMLVideoElement | HTMLAudioElement

function cachedPath(el: Media): string | null {
  const src = el.currentSrc || el.src
  if (!src.startsWith('moho-media:')) return null
  const path = new URL(src).searchParams.get('p')
  return path && RESTORABLE.test(path) ? path : null
}

function restore(path: string, bufferId?: string, messageId?: string): Promise<string | null> {
  let pending = inFlight.get(path)
  if (!pending) {
    pending = window.moho
      .rpc<{ path: string }>('restoreMedia', { path, bufferId, messageId })
      .then((r) => r.path)
      .catch(() => {
        gone.add(path)
        return null
      })
      .finally(() => inFlight.delete(path))
    inFlight.set(path, pending)
  }
  return pending
}

/** Lets a failure through to the element's own handler after all. */
function failAfterAll(el: Media): void {
  el.dataset.restoreGaveUp = '1'
  el.dispatchEvent(new Event('error'))
}

export function restoreMissingMedia(): () => void {
  const onError = (e: Event): void => {
    const el = e.target
    if (!(el instanceof HTMLImageElement || el instanceof HTMLVideoElement || el instanceof HTMLAudioElement)) return
    if (el.dataset.restoreGaveUp) return
    const path = cachedPath(el)
    if (!path) return
    // Known to be past saving, or already restored once for this element and
    // still failing: let it fail as it always did.
    if (gone.has(path) || el.dataset.restoreTried === path) return
    el.dataset.restoreTried = path
    e.stopPropagation()

    const row = el.closest<HTMLElement>('[data-msg-id]')
    void restore(path, row?.dataset.bufferId, row?.dataset.msgId).then((restored) => {
      if (!restored) {
        failAfterAll(el)
        return
      }
      // A new URL for the same file, so nothing serves the failure again
      // from memory.
      el.src = `${resolveMediaUrl(restored)}&r=${Date.now()}`
    })
  }
  document.addEventListener('error', onError, true)
  return () => document.removeEventListener('error', onError, true)
}
