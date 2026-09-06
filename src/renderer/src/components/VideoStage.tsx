import type { ReactNode } from 'react'
import { Icon, IconButton } from './Icon'
import { classes } from '../lib/util'

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
  // Put away without being ended. Something being listened to while reading
  // something else does not need a picture on screen, and closing the picture
  // must not close what is behind it - so this is a bar with a way back.
  if (minimized) {
    return (
      <div className={classes('call-stage', 'minimized', mode === 'pip' && 'pip')}>
        <div className="call-stage-controls">
          <Icon name={endIcon === 'call_end' ? 'call' : 'live_tv'} size={16} />
          <span className="small muted ellipsis">{subtitle}</span>
          <IconButton name="expand_less" title="Show it again" onClick={() => onMinimized(false)} />
          <IconButton name={endIcon} title={endLabel} className="calling" onClick={onEnd} />
        </div>
      </div>
    )
  }

  return (
    <div className={classes('call-stage', mode === 'pip' && 'pip')}>
      {mode === 'pip' && (
        <div className="call-stage-title">
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
