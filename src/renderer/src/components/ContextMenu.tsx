import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

export interface MenuItem {
  label: string
  icon?: string
  danger?: boolean
  disabled?: boolean
  separator?: false
  onClick: () => void
}

export interface MenuSeparator {
  separator: true
}

export type MenuEntry = MenuItem | MenuSeparator

interface Props {
  x: number
  y: number
  entries: MenuEntry[]
  onClose: () => void
}

/**
 * Rendered into a portal at the document root so it can escape any scrolling
 * or clipping ancestor, then nudged back inside the viewport once its real
 * size is known.
 */
export function ContextMenu({ x, y, entries, onClose }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))
    })
  }, [x, y, entries.length])

  useEffect(() => {
    const dismiss = (): void => onClose()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // `capture` so a click that also lands on some other handler still closes
    // this first, rather than leaving two menus stacked.
    window.addEventListener('mousedown', dismiss, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', dismiss, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {entries.map((entry, i) =>
        entry.separator ? (
          <div key={i} className="context-menu-separator" />
        ) : (
          <button
            key={i}
            type="button"
            className={`context-menu-item${entry.danger ? ' danger' : ''}`}
            disabled={entry.disabled}
            onClick={() => {
              entry.onClick()
              onClose()
            }}
          >
            {entry.icon && <Icon name={entry.icon} size={16} />}
            <span>{entry.label}</span>
          </button>
        )
      )}
    </div>,
    document.body
  )
}

/** Manages the open/closed state and click position for one context menu. */
export function useContextMenu(): {
  menu: { x: number; y: number } | null
  open: (e: React.MouseEvent) => void
  close: () => void
} {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  return {
    menu,
    open: (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setMenu({ x: e.clientX, y: e.clientY })
    },
    close: () => setMenu(null)
  }
}
