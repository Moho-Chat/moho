import type { ChatStore } from '../state/store'

/**
 * The profile card on hover (#339): resting the pointer on a name or avatar for a moment opens the same card a
 * click does, showing its top; moving off puts it away after a short grace, long enough to move onto the card
 * itself, where it stays; pressing anything on it keeps it open.
 */

/** How long the pointer rests before the card opens, and how long it may be away before the card goes. */
const OPEN_AFTER_MS = 600
const CLOSE_AFTER_MS = 250

let opening: ReturnType<typeof setTimeout> | null = null
let closing: ReturnType<typeof setTimeout> | null = null
let owner: ChatStore | null = null

function clear(): void {
  if (opening) clearTimeout(opening)
  if (closing) clearTimeout(closing)
  opening = closing = null
}

/** The handlers for a name or avatar that opens somebody's card. */
export function profileHoverProps(
  store: ChatStore,
  bufferId: string,
  nick: string,
  userId?: string
): { onMouseEnter: (e: React.MouseEvent) => void; onMouseLeave: () => void } {
  return {
    onMouseEnter: (e) => {
      const target = e.currentTarget
      owner = store
      clear()
      store.profileHoverCancelled = false
      opening = setTimeout(() => {
        opening = null
        store.showProfile(bufferId, nick, userId, { anchor: target, hover: true })
      }, OPEN_AFTER_MS)
    },
    onMouseLeave: releaseProfileHover
  }
}

/** The pointer reached the card: it stays. */
export function holdProfileHover(): void {
  if (closing) clearTimeout(closing)
  closing = null
}

/** The pointer left the name or the card: unless it comes back, the card goes. */
export function releaseProfileHover(): void {
  const store = owner
  if (opening) {
    clearTimeout(opening)
    opening = null
  }
  if (!store) return
  store.profileHoverCancelled = true
  if (closing) clearTimeout(closing)
  closing = setTimeout(() => {
    closing = null
    if (store.getSnapshot().profileHover) store.closeProfile()
  }, CLOSE_AFTER_MS)
}
