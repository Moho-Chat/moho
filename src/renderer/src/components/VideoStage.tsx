import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Icon, IconButton } from './Icon'
import { usePref } from '../state/hooks'
import { classes } from '../lib/util'

/** How close to an edge the panel may be parked. */
const EDGE = 4

/**
 * The frame a moving picture lives in, whatever is feeding it.
 *
 * A Matrix call and a Kick stream have almost nothing in common underneath -
 * one is real-time media negotiated with another person, the other is a
 * signed playlist off a CDN - but on screen they are the same thing: a picture
 * above the conversation, a corner it retreats to when you walk away, a way to
 * put it down without ending it, and a way to end it. That is what this holds,
 * so the two sources argue about codecs rather than about margins.
 *
 * What varies goes in as children and controls; what must not vary - where the
 * minimise lives, what the corner's title bar looks like, what the put-away
 * bar says - lives here.
 */
export function VideoStage({
  mode,
  /** Who or what is on screen, named. Shown in the corner's title bar. */
  title,
  /** What it is doing: "Connected", "Live · 4,102 watching". */
  subtitle,
  minimized,
  onMinimized,
  /** Back to the conversation this belongs to, from the corner. */
  onGoTo,
  /** The one that ends it, and what to call that. */
  onEnd,
  endLabel,
  endIcon = 'call_end',
  /** Buttons that belong to this source: a microphone, a volume. */
  controls,
  children
}: {
  mode: 'inline' | 'pip'
  title: string
  subtitle: string
  minimized: boolean
  onMinimized: (minimized: boolean) => void
  onGoTo: () => void
  onEnd: () => void
  endLabel: string
  endIcon?: string
  controls?: ReactNode
  children: ReactNode
}): JSX.Element {
  const panel = useRef<HTMLDivElement>(null)
  /**
   * Where the corner panel has been put, if anywhere.
   *
   * Null is the corner it starts in, which is where it belongs until somebody
   * says otherwise - a remembered position is only worth having because
   * somebody chose it, and a default written down as coordinates would drift
   * with every change to the layout around it.
   *
   * Remembered across restarts, because moving it is a decision about this
   * screen and this window, and having to make it again every launch is the
   * whole complaint about panels that cannot be moved.
   */
  const [saved, setSaved] = usePref<{ x: number; y: number } | null>('ui.pipSpot', null)
  // Followed during a drag rather than written on every pointer move: the
  // preference goes to disk over IPC, and a drag is a hundred of them.
  const [spot, setSpot] = useState(saved)
  const grab = useRef<{ dx: number; dy: number } | null>(null)

  /**
   * Where the panel may be put, in the coordinates it is positioned in.
   *
   * Kept reachable: a panel dragged off the edge is a panel lost, and a call
   * that cannot be hung up because its buttons are past the screen edge is
   * worse than one that will not move at all.
   */
  const clamp = useCallback((x: number, y: number): { x: number; y: number } => {
    const el = panel.current
    const box = el?.getBoundingClientRect()
    const within = (el?.offsetParent as HTMLElement | null)?.getBoundingClientRect()
    const size = { w: box?.width ?? 340, h: box?.height ?? 200 }
    const room = { w: within?.width ?? window.innerWidth, h: within?.height ?? window.innerHeight }
    // Wholly inside, not merely mostly. Half off the edge would leave the
    // panel's own controls hanging past the window with only the part that
    // is not a handle still reachable - picked up once and never again.
    //
    // Not into the window's own title bar either: that bar is a compositor
    // drag region, and a press inside one starts a window move before the
    // page ever sees it.
    const bar = document.querySelector('.titlebar')?.getBoundingClientRect()
    const floor = bar ? Math.max(bar.bottom - (within?.top ?? 0), 0) : 0
    return {
      x: Math.min(Math.max(x, EDGE), Math.max(room.w - size.w - EDGE, EDGE)),
      y: Math.min(Math.max(y, floor + EDGE), Math.max(room.h - size.h - EDGE, floor + EDGE))
    }
  }, [])

  /** Viewport coordinates, as the panel's own positioning sees them. */
  const local = useCallback((x: number, y: number): { x: number; y: number } => {
    const within = (panel.current?.offsetParent as HTMLElement | null)?.getBoundingClientRect()
    return { x: x - (within?.left ?? 0), y: y - (within?.top ?? 0) }
  }, [])

  // A window made smaller - or a position remembered from a larger screen -
  // can leave it outside. The same clamp, applied to where it already is,
  // on arrival and whenever the room changes shape.
  useEffect(() => {
    const fit = (): void =>
      setSpot((was) => {
        if (!was) return was
        const to = clamp(was.x, was.y)
        // Same object when nothing moved: a new one every pass would set
        // state forever.
        return to.x === was.x && to.y === was.y ? was : to
      })
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [clamp, minimized, mode])

  const startDrag = (e: PointerEvent<HTMLDivElement>): void => {
    // The bar is the handle, but the controls on it are not: pressing
    // minimise should minimise rather than pick the panel up.
    if (mode !== 'pip' || (e.target as HTMLElement).closest('button')) return
    const box = panel.current?.getBoundingClientRect()
    if (!box) return
    grab.current = { dx: e.clientX - box.left, dy: e.clientY - box.top }
    const here = local(box.left, box.top)
    setSpot(clamp(here.x, here.y))
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  const onDrag = (e: PointerEvent<HTMLDivElement>): void => {
    if (!grab.current) return
    const to = local(e.clientX - grab.current.dx, e.clientY - grab.current.dy)
    setSpot(clamp(to.x, to.y))
  }

  const endDrag = (e: PointerEvent<HTMLDivElement>): void => {
    if (!grab.current) return
    grab.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
    // Now that it has come to rest, and once rather than throughout.
    setSpot((rest) => {
      setSaved(rest)
      return rest
    })
  }

  /** Where it sits: the corner it started in, or where it was put. */
  const placed =
    mode === 'pip' && spot ? { left: `${spot.x}px`, top: `${spot.y}px`, right: 'auto', bottom: 'auto' } : undefined
  const handle =
    mode === 'pip'
      ? { onPointerDown: startDrag, onPointerMove: onDrag, onPointerUp: endDrag, onPointerCancel: endDrag }
      : {}

  // Put away without being ended. Something being listened to while reading
  // something else does not need a picture on screen, and closing the picture
  // must not close what is behind it - so this is a bar with a way back.
  if (minimized) {
    return (
      <div className={classes('call-stage', 'minimized', mode === 'pip' && 'pip')} ref={panel} style={placed}>
        {/* The bar is the whole panel here, so the bar is the handle. */}
        <div className={classes('call-stage-controls', mode === 'pip' && 'draggable')} {...handle}>
          <Icon name={endIcon === 'call_end' ? 'call' : 'live_tv'} size={16} />
          <span className="small muted ellipsis">{subtitle}</span>
          <IconButton name="expand_less" title="Show it again" onClick={() => onMinimized(false)} />
          <IconButton name={endIcon} title={endLabel} className="calling" onClick={onEnd} />
        </div>
      </div>
    )
  }

  return (
    <div className={classes('call-stage', mode === 'pip' && 'pip')} ref={panel} style={placed}>
      {mode === 'pip' && (
        /* Dragged by its title bar, the way anything shaped like a window is. */
        <div className="call-stage-title draggable" {...handle}>
          <Icon name={endIcon === 'call_end' ? 'call' : 'live_tv'} size={14} />
          <span className="small ellipsis" title={title}>
            {title || subtitle}
          </span>
          {/* Back to where this is happening, which turns the corner back into
              the conversation - the picture stops being a corner of somewhere
              else and becomes the room you are in. */}
          <IconButton name="open_in_full" size={14} title="Go to it" onClick={onGoTo} />
          {/* Where a window's own control would be, because in the corner this
              is a window: the thing you close is closed from its top right. */}
          <IconButton name="remove" size={14} title="Minimise" onClick={() => onMinimized(true)} />
        </div>
      )}

      {children}

      <div className="call-stage-controls">
        {/* Which conversation this belongs to, because the picture no longer
            sits under it: it outlives looking at something else. */}
        <span className="small muted ellipsis">{subtitle}</span>
        {controls}
        {/* Out of the way without ending. In the corner this sits in the title
            bar instead, where a window's own controls live. */}
        {mode !== 'pip' && (
          <IconButton name="expand_more" title="Minimise" onClick={() => onMinimized(true)} />
        )}
        <IconButton name={endIcon} title={endLabel} className="calling" onClick={onEnd} />
      </div>
    </div>
  )
}
