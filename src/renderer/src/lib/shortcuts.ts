import { useEffect } from 'react'
import { store } from '../state/store'

/** Anything that opens over the window and has its own use for Escape. */
const LAYERS =
  '.context-menu, .header-popover, .modal-scrim, .lightbox-backdrop, .emoji-picker, .stage-popover, [role="dialog"], [role="menu"], [aria-modal="true"]'

/**
 * Somewhere text is being typed, where Escape belongs to the field. Not the
 * message box: that is where somebody nearly always is, its own Escapes (an
 * open list, a reply being cancelled) say so by handling the key first, and
 * what is left is "I am done here".
 */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.classList.contains('composer-input')) return false
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
}

/**
 * Keys that act on the app rather than on a field, as Discord has them:
 * Escape reads the conversation you are in and takes you to its end, and
 * Shift+Escape reads the whole server.
 *
 * Only when nothing else wants the key: a menu, a dialog or a picker open, a
 * field being typed in, or a full-page panel showing all come first.
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      if (typing(e.target) || document.querySelector(LAYERS)) return
      const state = store.getSnapshot()
      if (state.activePanel !== '') return

      if (e.shiftKey) {
        const ids = state.buffers
          .filter((b) => b.groupId === state.activeGroupId && (b.unread > 0 || b.highlight))
          .map((b) => b.id)
        if (ids.length === 0) return
        e.preventDefault()
        void store.markBuffersRead(ids)
        store.toast('info', `Marked ${ids.length} ${ids.length === 1 ? 'conversation' : 'conversations'} as read`)
        return
      }

      const open = state.buffers.find((b) => b.id === state.activeBufferId)
      if (!open) return
      e.preventDefault()
      if (open.unread > 0 || open.highlight) void store.markBuffersRead([open.id])
      window.dispatchEvent(new CustomEvent('moho:jump-to-present'))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
