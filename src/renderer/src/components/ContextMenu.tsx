import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { useEscapeLayer } from '../lib/layers'

export interface MenuItem {
  label: string
  icon?: string
  danger?: boolean
  disabled?: boolean
  separator?: false
  /** On or chosen: drawn with a tick, and read as such by a screen reader. */
  checked?: boolean
  /** The key that does this without the menu, said beside it: "Ctrl+K". */
  shortcut?: string
  onClick: () => void
}

export interface MenuSeparator {
  separator: true
}

/**
 * A value set by dragging, which stays open while it is dragged - the way
 * Discord puts "User Volume" in the menu of the person it is for.
 */
export interface MenuSlider {
  slider: true
  separator?: false
  label: string
  value: number
  min: number
  max: number
  step: number
  /** How the value reads beside the label. */
  format: (value: number) => string
  onChange: (value: number) => void
}

export type MenuEntry = MenuItem | MenuSeparator | MenuSlider

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

  useEscapeLayer(onClose)

  // Opened from the keyboard or the mouse, it is the thing with focus, so the
  // arrows work at once and closing it gives the focus back to where it was.
  useEffect(() => {
    const before = document.activeElement
    ref.current?.focus({ preventScroll: true })
    return () => {
      if (before instanceof HTMLElement && document.contains(before)) before.focus({ preventScroll: true })
    }
  }, [])

  /** The entries that can be moved onto, in order. */
  const items = (): HTMLButtonElement[] =>
    [...(ref.current?.querySelectorAll<HTMLButtonElement>('button.context-menu-item:not([disabled])') ?? [])]
  const move = (to: 'next' | 'previous' | 'first' | 'last'): void => {
    const list = items()
    if (list.length === 0) return
    const here = list.indexOf(document.activeElement as HTMLButtonElement)
    const index =
      to === 'first' ? 0 : to === 'last' ? list.length - 1 : to === 'next' ? (here + 1) % list.length : (here <= 0 ? list.length : here) - 1
    list[index].focus()
  }

  useEffect(() => {
    // A menu belongs to the place it was opened over: once that scrolls away,
    // or the window is left, it has nothing to point at.
    const away = (): void => onClose()
    window.addEventListener('scroll', away, true)
    window.addEventListener('blur', away)
    return () => {
      window.removeEventListener('scroll', away, true)
      window.removeEventListener('blur', away)
    }
  }, [onClose])

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
    window.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('resize', onResize)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      tabIndex={-1}
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={(e) => {
        const keys: Record<string, 'next' | 'previous' | 'first' | 'last'> = {
          ArrowDown: 'next',
          ArrowUp: 'previous',
          Home: 'first',
          End: 'last'
        }
        if (e.key in keys) {
          e.preventDefault()
          move(keys[e.key])
        } else if (e.key === 'Tab') {
          // Leaving the menu by Tab is closing it.
          e.preventDefault()
          onClose()
        }
      }}
    >
      {entries.map((entry, i) =>
        entry.separator ? (
          <div key={i} className="context-menu-separator" />
        ) : 'slider' in entry ? (
          <label key={i} className="context-menu-slider">
            <span className="context-menu-slider-label">
              <span>{entry.label}</span>
              <span className="muted">{entry.format(entry.value)}</span>
            </span>
            <input
              type="range"
              min={entry.min}
              max={entry.max}
              step={entry.step}
              value={entry.value}
              aria-label={entry.label}
              onChange={(e) => entry.onChange(Number(e.target.value))}
            />
          </label>
        ) : (
          <button
            key={i}
            type="button"
            role={entry.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={entry.checked}
            className={`context-menu-item${entry.danger ? ' danger' : ''}`}
            disabled={entry.disabled}
            onClick={() => {
              entry.onClick()
              onClose()
            }}
          >
            {entry.icon && <Icon name={entry.icon} size={16} />}
            <span className="context-menu-label">{entry.label}</span>
            {entry.shortcut && <kbd className="context-menu-shortcut">{entry.shortcut}</kbd>}
            {entry.checked && <Icon name="check" size={16} className="context-menu-check" />}
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
  /** Opens it under an element rather than at the pointer: for a button that is a menu. */
  openFrom: (el: HTMLElement) => void
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
    openFrom: (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      // To the side of a button in a column, below one in a row; the menu
      // nudges itself back inside the window either way.
      const side = r.width < 80 && r.left < 120
      setMenu(side ? { x: r.right + 6, y: r.top } : { x: r.left, y: r.bottom + 4 })
    },
    close: () => setMenu(null)
  }
}
