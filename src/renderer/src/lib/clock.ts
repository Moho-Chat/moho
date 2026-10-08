import { useSyncExternalStore } from 'react'

/**
 * One timer for every label that says how long ago something was.
 *
 * Rows are memoised, so nothing re-draws "just now" as it ages; this ticks
 * every thirty seconds and the rows that asked for it re-draw. Shared, so a
 * thousand rows are one interval and not a thousand - and idle, with no timer
 * at all, when none is listening.
 */
let now = Date.now()
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!timer) {
    timer = setInterval(() => {
      now = Date.now()
      for (const l of listeners) l()
    }, 30_000)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

/** The time, as of the last tick. */
export function useTick(active: boolean): number {
  return useSyncExternalStore(
    active ? subscribe : () => () => {},
    () => (active ? now : 0)
  )
}
