import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Icon } from '../Icon'
import { Avatar } from '../Avatar'
import { usePref } from '../../state/hooks'
import { classes, nickColor } from '../../lib/util'

/**
 * A call, drawn the way Discord's desktop client draws one.
 *
 * A black stage above the conversation that looks like a video before it has
 * any video in it: everybody a rounded sixteen-by-nine tile - their camera
 * where they have one on, otherwise their picture on a panel tinted with
 * their colour - a green ring on whoever is talking, their name in a pill in
 * the corner, and the buttons in a row along the bottom. Pressing somebody
 * makes them large with everybody else in a strip underneath; pressing them
 * again puts the grid back.
 *
 * Service-blind. A Matrix call and a Discord call hand this the same tiles
 * and the same buttons; which service it is decides what the tiles contain,
 * not what the stage looks like.
 */

export interface StageTile {
  id: string
  name: string
  avatarUrl?: string
  speaking?: boolean
  muted?: boolean
  deafened?: boolean
  /** A shared screen rather than a person, badged as live. */
  live?: boolean
  /**
   * The picture, where there is one: a camera or a shared screen.
   *
   * A function rather than an element because the same person can be drawn
   * twice at once - large on the stage and small in the strip - and each
   * place needs an element of its own.
   */
  picture?: (slot: 'main' | 'strip') => ReactNode
  /** A button across the middle of a tile with no picture: "Watch stream". */
  action?: { label: string; onClick: () => void }
  /** A small button in the corner of a tile with one: "Stop watching". */
  dismiss?: { label: string; onClick: () => void }
}

export interface StageButton {
  icon: string
  label: string
  /** On, in the sense of a toggle that is doing something now. */
  active?: boolean
  /** Off in the way that matters - a muted microphone, a camera off. */
  off?: boolean
  danger?: boolean
  onClick: () => void
}

/** Sixteen by nine, which is what cameras and screens both are. */
const TILE_RATIO = 16 / 9
const TILE_GAP = 8
/** No tile in the grid gets bigger than this, however much room there is. */
const TILE_MAX = 560

/**
 * How to lay out this many tiles in this much room.
 *
 * Every column count is tried and the one that makes the tiles biggest wins:
 * three people in a wide short stage want one row, the same three in a tall
 * narrow one want three.
 */
export function fitTiles(
  count: number,
  width: number,
  height: number,
  max: number = TILE_MAX
): { columns: number; tileWidth: number } {
  if (count < 1 || width < 1) return { columns: 1, tileWidth: 0 }
  let best = { columns: 1, tileWidth: 0 }
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns)
    const byWidth = (width - TILE_GAP * (columns - 1)) / columns
    const byHeight = ((height - TILE_GAP * (rows - 1)) / rows) * TILE_RATIO
    const tileWidth = Math.min(byWidth, byHeight, max)
    if (tileWidth > best.tileWidth) best = { columns, tileWidth }
  }
  return best
}

/** The room the buttons take along the bottom. */
const CONTROLS_SPACE = 76
/** And the title along the top. */
const TITLE_SPACE = 44
const STRIP_HEIGHT = 96
const MIN_HEIGHT = 220

export function Stage({
  title,
  subtitle,
  tiles,
  buttons,
  where,
  onPopOut,
  onBringBack
}: {
  title: string
  subtitle?: string
  tiles: StageTile[]
  buttons: StageButton[]
  /**
   * Above the conversation, or filling a window of its own. Inline, the
   * stage can be collapsed to a bar and resized by its bottom edge; in its
   * own window it is the window.
   */
  where: 'inline' | 'window'
  onPopOut?: () => void
  onBringBack?: () => void
}): JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const [room, setRoom] = useState({ width: 640, height: 300 })
  const [collapsed, setCollapsed] = usePref<boolean>('ui.stageCollapsed', false)
  /**
   * How tall the stage stands above the conversation, as somebody left it.
   * Remembered, because it is a decision about this screen - a laptop wants a
   * short stage and a monitor a tall one - and not one to make every call.
   */
  const [savedHeight, setSavedHeight] = usePref<number>('ui.stageHeight', 380)
  const [height, setHeight] = useState(savedHeight)
  useEffect(() => setHeight(savedHeight), [savedHeight])
  const [fullscreen, setFullscreen] = useState(false)

  // Measured, in whichever window the stage is in: a stage popped out is
  // measured against its own window, not the one that opened it.
  useEffect(() => {
    const el = area.current
    if (!el) return
    const view = el.ownerDocument.defaultView ?? window
    const measure = (): void => setRoom({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const observer = new view.ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [collapsed, where])

  useEffect(() => {
    const doc = root.current?.ownerDocument
    if (!doc) return
    const follow = (): void => setFullscreen(!!doc.fullscreenElement)
    doc.addEventListener('fullscreenchange', follow)
    return () => doc.removeEventListener('fullscreenchange', follow)
  }, [])

  const toggleFullscreen = (): void => {
    const el = root.current
    if (!el) return
    if (el.ownerDocument.fullscreenElement) void el.ownerDocument.exitFullscreen().catch(() => {})
    else void el.requestFullscreen().catch(() => {})
  }

  // Resizing by the bottom edge, inline only.
  const drag = useRef<{ startY: number; startHeight: number } | null>(null)
  const startResize = (e: PointerEvent<HTMLDivElement>): void => {
    drag.current = { startY: e.clientY, startHeight: height }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }
  const onResize = (e: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return
    const view = e.currentTarget.ownerDocument.defaultView ?? window
    const max = Math.max(MIN_HEIGHT, view.innerHeight * 0.8)
    setHeight(Math.round(Math.min(max, Math.max(MIN_HEIGHT, drag.current.startHeight + e.clientY - drag.current.startY))))
  }
  const endResize = (e: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return
    drag.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
    setSavedHeight(height)
  }

  // Somebody who has left cannot go on being the one looked at.
  const stage = tiles.find((t) => t.id === focused) ?? null
  const others = stage ? tiles.filter((t) => t.id !== stage.id) : []
  const grid = fitTiles(Math.max(tiles.length, 1), room.width, room.height)
  const stageFit = fitTiles(1, room.width, room.height - (others.length > 0 ? STRIP_HEIGHT + TILE_GAP : 0), Infinity)

  const drawTile = (tile: StageTile, slot: 'main' | 'strip', width: number): JSX.Element => {
    const picture = tile.picture?.(slot)
    const small = slot === 'strip' || width < 220
    return (
      <div
        key={`${tile.id}#${slot}`}
        role="button"
        tabIndex={0}
        className={classes('stage-tile', tile.speaking && 'speaking', slot === 'strip' && 'strip')}
        style={{
          width: `${Math.floor(width)}px`,
          // Tinted with the person's colour, the way Discord tints a tile with
          // somebody's banner: a room of identical grey boxes is a room nobody
          // can tell apart at a glance.
          background: picture ? '#000' : tile.live ? '#1e1f22' : `color-mix(in srgb, ${nickColor(tile.name)} 38%, #111214)`
        }}
        title={stage?.id === tile.id ? 'Back to everybody' : `Focus on ${tile.name}`}
        onClick={() => setFocused(stage?.id === tile.id ? null : tile.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setFocused(stage?.id === tile.id ? null : tile.id)
          }
        }}
      >
        {/* A screen nobody is watching yet is a dark panel with a button on
            it, not a face: the face is on the person's own tile beside it. */}
        {picture ?? (tile.live && tile.action ? null : (
          <span className="stage-tile-face">
            <Avatar name={tile.name} url={tile.avatarUrl} size={small ? 40 : Math.min(96, Math.max(48, width / 5))} />
          </span>
        ))}
        {tile.live && <span className="stage-tile-live">LIVE</span>}
        {!picture && tile.action && slot === 'main' && (
          <button
            type="button"
            className="stage-tile-action"
            onClick={(e) => {
              e.stopPropagation()
              tile.action?.onClick()
            }}
          >
            {tile.action.label}
          </button>
        )}
        {picture && tile.dismiss && (
          <button
            type="button"
            className="stage-tile-dismiss"
            title={tile.dismiss.label}
            aria-label={tile.dismiss.label}
            onClick={(e) => {
              e.stopPropagation()
              tile.dismiss?.onClick()
            }}
          >
            <Icon name="close" size={16} />
          </button>
        )}
        <span className="stage-tile-name">
          {tile.deafened ? (
            <Icon name="headset_off" size={14} className="stage-tile-state" />
          ) : tile.muted ? (
            <Icon name="mic_off" size={14} className="stage-tile-state" />
          ) : null}
          <span className="ellipsis">{tile.name}</span>
        </span>
      </div>
    )
  }

  const head = (
    <div className={classes('stage-head', where === 'window' && 'window-drag')}>
      <span className="stage-title ellipsis">
        <Icon name="volume_up" size={18} />
        <span className="ellipsis">{title}</span>
        {subtitle && <span className="stage-subtitle ellipsis">{subtitle}</span>}
      </span>
      <span className="stage-head-buttons">
        {where === 'inline' && onPopOut && (
          <HeadButton icon="open_in_new" label="Pop out into its own window" onClick={onPopOut} />
        )}
        {where === 'window' && onBringBack && (
          <HeadButton icon="close_fullscreen" label="Put it back in the conversation" onClick={onBringBack} />
        )}
        <HeadButton
          icon={fullscreen ? 'fullscreen_exit' : 'fullscreen'}
          label={fullscreen ? 'Leave full screen' : 'Full screen'}
          onClick={toggleFullscreen}
        />
        {where === 'inline' && (
          <HeadButton
            icon={collapsed ? 'expand_more' : 'expand_less'}
            label={collapsed ? 'Show the call' : 'Hide the call'}
            onClick={() => setCollapsed(!collapsed)}
          />
        )}
      </span>
    </div>
  )

  if (where === 'inline' && collapsed) {
    return (
      <div className="stage collapsed" ref={root}>
        {head}
        <div className="stage-controls compact">
          {buttons.map((b) => (
            <ControlButton key={b.label} button={b} compact />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      className={classes('stage', where === 'window' && 'in-window', fullscreen && 'fullscreen')}
      ref={root}
      style={where === 'inline' && !fullscreen ? { height: `${height}px` } : undefined}
    >
      {head}
      <div
        className="stage-area"
        ref={area}
        style={{ top: `${TITLE_SPACE}px`, bottom: `${CONTROLS_SPACE}px` }}
      >
        {tiles.length === 0 && <span className="stage-empty">Waiting for everybody…</span>}
        {stage ? (
          <div className="stage-focus">
            {drawTile(stage, 'main', stageFit.tileWidth)}
            {others.length > 0 && (
              <div className="stage-strip" style={{ height: `${STRIP_HEIGHT}px` }}>
                {others.map((tile) => drawTile(tile, 'strip', (STRIP_HEIGHT * 16) / 9))}
              </div>
            )}
          </div>
        ) : (
          <div
            className="stage-grid"
            style={{ gridTemplateColumns: `repeat(${grid.columns}, ${Math.floor(grid.tileWidth)}px)` }}
          >
            {tiles.map((tile) => drawTile(tile, 'main', grid.tileWidth))}
          </div>
        )}
      </div>
      <div className="stage-controls">
        {buttons.map((b) => (
          <ControlButton key={b.label} button={b} />
        ))}
      </div>
      {where === 'inline' && !fullscreen && (
        <div
          className="stage-resize"
          title="Drag to resize"
          onPointerDown={startResize}
          onPointerMove={onResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        />
      )}
    </div>
  )
}

function HeadButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }): JSX.Element {
  return (
    <button type="button" className="stage-head-button" title={label} aria-label={label} onClick={onClick}>
      <Icon name={icon} size={20} />
    </button>
  )
}

function ControlButton({ button, compact }: { button: StageButton; compact?: boolean }): JSX.Element {
  return (
    <button
      type="button"
      className={classes(
        'stage-button',
        compact && 'compact',
        button.active && 'active',
        button.off && 'off',
        button.danger && 'danger'
      )}
      title={button.label}
      aria-label={button.label}
      aria-pressed={button.active || button.off ? true : undefined}
      onClick={button.onClick}
    >
      <Icon name={button.icon} size={compact ? 18 : 24} />
    </button>
  )
}
