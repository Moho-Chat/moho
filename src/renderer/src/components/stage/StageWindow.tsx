import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** The name the main process recognises and lets open - see main/index.ts. */
export const STAGE_WINDOW_NAME = 'moho-call'

/**
 * A call in a window of its own.
 *
 * Opened from this window and drawn into by it, rather than being a second
 * copy of the app: a Matrix call's media lives in this renderer - WebRTC
 * belongs to the page that opened it - and a separate window would have no
 * way to show a stream it does not own. A child window of this one shares the
 * same JavaScript, the same store and the same live streams, so the stage
 * that was above the conversation a moment ago is simply drawn over there
 * instead, mid-call, with nothing reconnected.
 *
 * The child starts blank, so it is given this window's stylesheets and theme
 * and told where relative URLs are - the icon font is one - before anything
 * is drawn into it.
 */
export function StageWindow({ children, onClosed }: { children: ReactNode; onClosed: () => void }): JSX.Element | null {
  const [mount, setMount] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const child = window.open('', STAGE_WINDOW_NAME, 'width=1024,height=640')
    if (!child) {
      onClosed()
      return
    }
    const doc = child.document
    doc.title = 'moho — call'
    const base = doc.createElement('base')
    base.href = document.baseURI
    doc.head.appendChild(base)
    for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"], meta[http-equiv]')) {
      doc.head.appendChild(node.cloneNode(true))
    }
    // The theme lives on the root element as attributes and inline custom
    // properties; without them the stage's chrome would be the wrong colours.
    for (const attr of Array.from(document.documentElement.attributes)) {
      doc.documentElement.setAttribute(attr.name, attr.value)
    }
    doc.body.className = document.body.className
    doc.body.style.margin = '0'
    doc.body.style.background = '#000'
    const container = doc.createElement('div')
    container.className = 'stage-window-root'
    doc.body.appendChild(container)
    setMount(container)

    // Closed from its own title bar or the compositor, rather than from the
    // button that puts it back.
    let done = false
    const closed = (): void => {
      if (done) return
      done = true
      onClosed()
    }
    child.addEventListener('pagehide', closed)
    const watch = window.setInterval(() => child.closed && closed(), 500)
    return () => {
      done = true
      window.clearInterval(watch)
      child.removeEventListener('pagehide', closed)
      if (!child.closed) child.close()
    }
    // Opened once per popping-out; the callback changing does not reopen it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return mount ? createPortal(children, mount) : null
}
