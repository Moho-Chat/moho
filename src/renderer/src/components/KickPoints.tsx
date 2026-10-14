import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useChat } from '../state/hooks'
import { RewardsPanel } from './RewardsPanel'

/**
 * A Kick channel's points, and the way into what the streamer will trade them for.
 *
 * A plaque at the foot of the viewer list, because that is where Kick puts it and because it belongs to the
 * channel rather than to the conversation - it is a fact about standing in this room, like the viewer count
 * above it. Pressing it opens the rewards panel over the chat (RewardsPanel.tsx), the same one Twitch's plaque
 * opens, instead of a menu of its own.
 */

/** How often the balance is asked for while this channel is on screen. */
const POINTS_INTERVAL_MS = 60_000

export function KickPoints({ bufferId }: { bufferId: string }): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [points, setPoints] = useState<number | null>(null)

  // Told by Kick the moment it changes, where the daemon is following it; the timer below is for a channel that
  // is not live, which is not followed.
  const pushed = useChat((s) => s.kickPointsByBuffer[bufferId])
  useEffect(() => {
    if (pushed !== undefined) setPoints(pushed)
  }, [pushed])

  // The balance, shown whether or not the panel is open, and kept current while somebody is actually looking at
  // this channel: this component exists only for the conversation on screen, and is paused with the window.
  useEffect(() => {
    let cancelled = false
    const ask = (): void => {
      if (document.visibilityState !== 'visible') return
      void window.moho
        .rpc<{ points: number }>('kickPoints', { bufferId })
        .then((a) => !cancelled && setPoints(a.points))
        // A channel that will not say leaves the last number rather than blanking the plaque.
        .catch(() => {})
    }
    setPoints(null)
    ask()
    const timer = setInterval(ask, POINTS_INTERVAL_MS)
    document.addEventListener('visibilitychange', ask)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', ask)
    }
  }, [bufferId])

  // Closing the channel takes the panel with it, so it cannot be left open over a conversation it is not about.
  useEffect(() => setOpen(false), [bufferId])

  return (
    <div className="kick-points">
      <button type="button" className={`kick-points-plaque${open ? ' open' : ''}`} title="Channel points, and what they buy" onClick={() => setOpen(true)}>
        <Icon name="toll" size={15} />
        <span className="ellipsis">{points === null ? 'Points' : points.toLocaleString()}</span>
        <Icon name="redeem" size={15} />
      </button>
      {open && <RewardsPanel bufferId={bufferId} service="kick" onClose={() => setOpen(false)} onBalance={setPoints} />}
    </div>
  )
}
