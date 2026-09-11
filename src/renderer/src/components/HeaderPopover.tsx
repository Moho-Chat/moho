import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * A panel hanging from a header button, over the conversation.
 *
 * Fixed rather than absolute, and measured against the viewport rather than
 * against whatever it grew out of: the header is a row of things competing
 * for a width that shrinks with the window, and a panel laid out inside it
 * either widens the row - pushing the buttons over the member list and off
 * the screen - or gets clipped by the row that holds it. Hanging it off the
 * button and clamping it to the window is the only arrangement where neither
 * can happen.
 *
 * Closes on Escape and on a click anywhere else, which is what every other
 * transient panel in this client does.
 */
export function HeaderPopover({
  anchor,
  width = 380,
  className,
  onClose,
  children
}: {
  /** The button it hangs from. */
  anchor: HTMLElement | null
  width?: number
  className?: string
  onClose: () => void
  children: React.ReactNode
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ top: number; left: number; width: number } | null>(null)

  // Measured after layout rather than on render: the panel's own height is
  // whatever its contents make it, and the button may have moved since the
  // click that opened it (the header reflows as things load).
  useLayoutEffect(() => {
    const place = (): void => {
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const margin = 8
      const w = Math.min(width, window.innerWidth - margin * 2)
      // Right-aligned with the button, then pushed back onto the screen if
      // that would hang it off either edge.
      const left = Math.min(Math.max(margin, rect.right - w), window.innerWidth - margin - w)

      // Below the button where it fits, above it where it does not.
      //
      // Below was the only option for a long time, which was right while
      // every one of these hung off the header at the top of the window. The
      // composer is at the *bottom*: a panel opened from a button down there
      // went off the end of the screen entirely, which is a panel nobody can
      // read or reach.
      //
      // The height is the rendered one rather than the CSS cap, because the
      // cap is 60vh and most of these are three fields - flipping a short
      // panel on the strength of a height it never reaches would send it
      // upwards from buttons that had room all along.
      const height = box.current?.getBoundingClientRect().height ?? 0
      const below = rect.bottom + 6
      const above = rect.top - 6 - height
      const top = below + height <= window.innerHeight - margin ? below : Math.max(margin, above)
      setAt({ top, left, width: w })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor, width, children])

  useEffect(() => {
    const away = (e: MouseEvent): void => {
      if (box.current?.contains(e.target as Node)) return
      if (anchor?.contains(e.target as Node)) return
      onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [anchor, onClose])

  return (
    <div
      ref={box}
      className={className ? `header-popover ${className}` : 'header-popover'}
      // The width is applied before the panel is placed, so the height
      // measured above is the height this will actually have: measured at
      // some other width, a panel that wraps to two lines is mistaken for one
      // that wraps to three, and the flip is decided on the wrong number.
      style={
        at
          ? { top: at.top, left: at.left, width: at.width }
          : { visibility: 'hidden', width: Math.min(width, window.innerWidth - 16) }
      }
    >
      {children}
    </div>
  )
}
