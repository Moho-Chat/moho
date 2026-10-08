import { useEffect } from 'react'
import { store } from '../state/store'
import { OPEN_SWITCHER } from '../components/QuickSwitcher'

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
    /**
     * The channel list as it is drawn - collapsed categories left out, the
     * order the person sees - which is what "next" has to mean. Read off the
     * page rather than worked out again from the data.
     */
    const step = (direction: 1 | -1, unreadOnly: boolean): void => {
      const rows = [...document.querySelectorAll<HTMLElement>('.buffer-row')]
      if (rows.length === 0) return
      const here = rows.findIndex((r) => r.classList.contains('active'))
      for (let n = 1; n <= rows.length; n++) {
        const row = rows[(((here < 0 ? (direction === 1 ? -1 : rows.length) : here) + direction * n) % rows.length + rows.length) % rows.length]
        if (unreadOnly && !row.classList.contains('unread')) continue
        row.click()
        row.scrollIntoView({ block: 'nearest' })
        return
      }
    }

    const onCombo = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return
      const mod = e.ctrlKey || e.metaKey
      // Jump to a conversation, from anywhere including the message box.
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent(OPEN_SWITCHER))
        return
      }
      if (mod && !e.altKey && !e.shiftKey && e.key === ',') {
        e.preventDefault()
        store.setActivePanel('settings')
        return
      }
      // Previous and next channel, and previous and next with something waiting.
      if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (document.querySelector(LAYERS)) return
        e.preventDefault()
        step(e.key === 'ArrowDown' ? 1 : -1, e.shiftKey)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keydown', onCombo)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keydown', onCombo)
    }
  }, [])
}
