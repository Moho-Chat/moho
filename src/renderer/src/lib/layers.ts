import { useEffect, useRef } from 'react'

/**
 * Who Escape belongs to, when several things are open.
 *
 * Every popup, dialog and panel used to listen for Escape on its own, on the
 * window, so one press closed all of them at once: a menu open over a dialog
 * took the dialog with it. They register here instead, in the order they
 * opened, and Escape goes to the last - the one on top - and to nothing else.
 *
 * A field that handles Escape itself (closing a suggestion list, cancelling a
 * reply) says so by preventing the default, which this honours.
 */
interface Layer {
  close: () => void
}

const stack: Layer[] = []
let installed = false

function install(): void {
  if (installed) return
  installed = true
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    const top = stack[stack.length - 1]
    if (!top) return
    e.preventDefault()
    top.close()
  })
}

/** Whether anything is open that would take Escape. */
export function hasLayer(): boolean {
  return stack.length > 0
}

/**
 * Takes part in Escape while `active`, for as long as this component is
 * mounted. Where it stands in the order is when it became active, not when it
 * was last re-rendered: `close` is read through a ref, so a new function on
 * every render does not send this to the top.
 */
export function useEscapeLayer(close: () => void, active = true): void {
  const latest = useRef(close)
  latest.current = close
  useEffect(() => {
    if (!active) return
    const layer: Layer = { close: () => latest.current() }
    stack.push(layer)
    install()
    return () => {
      const i = stack.indexOf(layer)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [active])
}
