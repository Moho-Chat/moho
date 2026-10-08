/**
 * What the toast stack does with a new message.
 *
 * Kept apart from the store so the two rules can be tested without one: the
 * same words saying the same thing again are one toast that says how many
 * times, not a column of copies; and the column never holds more than a few,
 * the oldest giving way - a burst of errors must not paper over the window.
 */
export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastItem {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
  /** How many times this has been said while it was showing. */
  count: number
  /** When it was last said, so repeating it starts its time over. */
  stamp: number
  action?: ToastAction
}

export const MAX_TOASTS = 3

export function addToast(
  list: ToastItem[],
  next: { id: number; kind: ToastItem['kind']; text: string; action?: ToastAction },
  now = Date.now()
): ToastItem[] {
  const same = list.find((t) => t.kind === next.kind && t.text === next.text)
  if (same) {
    return list.map((t) => (t === same ? { ...t, count: t.count + 1, stamp: now, action: next.action ?? t.action } : t))
  }
  return [...list, { ...next, count: 1, stamp: now }].slice(-MAX_TOASTS)
}

/** How long a toast stays: errors and anything with an action are given longer to be read. */
export function toastLifetime(t: Pick<ToastItem, 'kind' | 'action' | 'text'>): number {
  const reading = Math.min(8000, 3000 + t.text.length * 40)
  return t.kind === 'error' || t.action ? Math.max(8000, reading) : Math.max(5000, reading)
}
