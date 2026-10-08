import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { toastLifetime, type ToastItem } from '../lib/toasts'

const ICONS = { info: 'info', success: 'check_circle', error: 'error' } as const

/** How long a toast takes to leave, which is what the exit animation lasts. */
const LEAVING_MS = 180

/**
 * Things that happened, top right.
 *
 * They slide in and out, wait while the pointer is on them (a message half
 * read is not one to take away), say how many times the same thing happened
 * rather than stacking copies, and carry a button where there is something to
 * do about it. `role=status` so a screen reader says them as they arrive.
 */
export function Toasts(): JSX.Element {
  const toasts = useChat((s) => s.toasts)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} />
      ))}
    </div>
  )
}

function ToastRow({ toast }: { toast: ToastItem }): JSX.Element {
  const store = useStore()
  const [hovered, setHovered] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const gone = useRef(false)

  const leave = (): void => {
    if (gone.current) return
    gone.current = true
    setLeaving(true)
    setTimeout(() => store.dismissToast(toast.id), LEAVING_MS)
  }

  // Its time, started over each time it is said again and held while the
  // pointer is on it.
  useEffect(() => {
    if (hovered || leaving) return
    const t = setTimeout(leave, toastLifetime(toast))
    return () => clearTimeout(t)
    // `leave` only closes over refs and stable store methods.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hovered, leaving, toast.stamp])

  return (
    <div
      className={`toast ${toast.kind}${leaving ? ' leaving' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Icon name={ICONS[toast.kind]} size={16} />
      <span className="toast-text">
        {toast.text}
        {toast.count > 1 && <span className="toast-count">×{toast.count}</span>}
      </span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action?.onClick()
            leave()
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="toast-close" onClick={leave} title="Dismiss" aria-label="Dismiss">
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}
