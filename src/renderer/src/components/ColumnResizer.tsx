import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { usePref } from '../state/hooks'

/**
 * A column's width as somebody left it: followed while a drag is under way and written down once, when it ends,
 * because a preference goes to disk over IPC and a drag is a hundred moves.
 */
export function useColumnWidth(key: string, fallback: number): [number, (width: number | null, commit: boolean) => void] {
  const [saved, setSaved] = usePref<number>(key, fallback)
  const [live, setLive] = useState<number | null>(null)
  const apply = (width: number | null, commit: boolean): void => {
    if (!commit) return setLive(width)
    setLive(null)
    setSaved(width ?? fallback)
  }
  return [live ?? saved, apply]
}

/**
 * The line between two columns, which can be dragged to change the width of one of them.
 *
 * `grows` says which way a drag makes the column wider: `right` for a column on the left of the line (the channel
 * list), `left` for one on its right (the member list). Double-click puts it back to its usual width, and the
 * arrow keys move it for somebody who is not using a pointer.
 */
export function ColumnResizer({
  width,
  onWidth,
  min,
  max,
  grows,
  label
}: {
  width: number
  onWidth: (width: number | null, commit: boolean) => void
  min: number
  max: number
  grows: 'left' | 'right'
  label: string
}): JSX.Element {
  const [dragging, setDragging] = useState(false)
  const [from, setFrom] = useState<{ x: number; w: number } | null>(null)
  const fit = (w: number): number => Math.round(Math.min(Math.max(w, min), Math.min(max, window.innerWidth * 0.45)))
  const at = (x: number, start: { x: number; w: number }): number => fit(start.w + (grows === 'right' ? x - start.x : start.x - x))

  const down = (e: PointerEvent<HTMLDivElement>): void => {
    setFrom({ x: e.clientX, w: width })
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.classList.add('resizing-column')
    e.preventDefault()
  }
  const move = (e: PointerEvent<HTMLDivElement>): void => {
    if (from) onWidth(at(e.clientX, from), false)
  }
  const up = (e: PointerEvent<HTMLDivElement>): void => {
    if (!from) return
    const done = at(e.clientX, from)
    setFrom(null)
    setDragging(false)
    document.body.classList.remove('resizing-column')
    e.currentTarget.releasePointerCapture(e.pointerId)
    onWidth(done, true)
  }
  const key = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? 40 : 10
    const toward = (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0) * (grows === 'right' ? 1 : -1)
    if (!toward) return
    e.preventDefault()
    onWidth(fit(width + toward * step), true)
  }

  return (
    <div
      className={`divider-v resizer${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => onWidth(null, true)}
      onKeyDown={key}
    />
  )
}
