import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

/**
 * Confirming something that cannot be undone from here.
 *
 * The delay is the point. Leaving a server is one click in a context menu and
 * permanent in effect - rejoining needs an invite, and for somewhere you were
 * invited to years ago there may be nobody left to ask. A button that is
 * simply *there* gets pressed by the hand that was already moving; one that
 * arrives a few seconds later is pressed by somebody who read the sentence
 * above it.
 *
 * Cancel is available throughout and is what Escape does, so the delay never
 * traps anyone - it only slows down the one direction that matters.
 */
const COUNTDOWN_SECONDS = 10

export function LeaveConfirm(props: {
  name: string
  /** What is lost, in the words of the service it belongs to. */
  detail: string
  onLeave: () => void
  onCancel: () => void
}): JSX.Element {
  const { name, detail, onLeave, onCancel } = props
  const [left, setLeft] = useState(COUNTDOWN_SECONDS)

  useEffect(() => {
    if (left <= 0) return
    const t = setTimeout(() => setLeft((n) => n - 1), 1000)
    return () => clearTimeout(t)
  }, [left])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return createPortal(
    <div className="lightbox-backdrop" onClick={onCancel}>
      <div className="leave-confirm" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="leave-confirm-head">
          <Icon name="warning" size={20} color="var(--warning)" />
          <span>Leave {name}?</span>
        </div>
        <p className="small">{detail}</p>
        <div className="leave-confirm-actions">
          <button type="button" className="button" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button
            type="button"
            className="button danger"
            disabled={left > 0}
            onClick={onLeave}
          >
            {left > 0 ? `Leave in ${left}` : 'Leave'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
