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
    // Presses inside the menu must not dismiss it. This listener runs in the
    // capture phase (so a press anywhere else closes the menu even if that
    // handler stops propagation), which means it fires *before* the menu
    // item's own handler - dismissing unconditionally unmounts the item
    // between mousedown and click, and the click then lands on nothing.
    // Stopping propagation on the menu's own mousedown can't help: that runs
    // in the bubble phase, long after this has already fired.
    const onMouseDown = (e: MouseEvent): void => {
      if (ref.current?.contains(e.target as Node)) return
      onClose()
    }
    const onResize = (): void => onClose()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      style={{ left: pos.x, top: pos.y }}
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
