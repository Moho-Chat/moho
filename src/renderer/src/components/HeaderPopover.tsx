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

  // Measured after layout rather than on render: the panel's own width is
  // whatever the window allows, and the button may have moved since the click
  // that opened it (the header reflows as things load).
  useLayoutEffect(() => {
    const place = (): void => {
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const margin = 8
      const room = window.innerWidth - margin * 2
      const w = Math.min(width, room)
      // Right-aligned with the button, then pushed back onto the screen if
      // that would hang it off either edge.
      const left = Math.min(Math.max(margin, rect.right - w), window.innerWidth - margin - w)
      setAt({ top: rect.bottom + 6, left, width: w })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor, width])

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
      style={at ? { top: at.top, left: at.left, width: at.width } : { visibility: 'hidden' }}
    >
      {children}
    </div>
  )
}
