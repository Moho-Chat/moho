import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useChat } from '../state/hooks'
import { RewardsPanel } from './RewardsPanel'

/**
 * A Twitch channel's points balance, and the way into the rewards panel (RewardsPanel.tsx) that Kick's plaque opens too.
 *
 * At the foot of the viewer list, where Kick's plaque is. Twitch's points are the person's own twitch.tv
 * session's to see and spend (see nobilis backend/twitch/points.rs), so it is drawn only for an account that has
 * that session, and the balance is read once a minute while the window is
 * on this channel. Moho does not claim the bonus chest or send the "watching" reports a points bot would to
 * earn faster.
 */
const REFRESH_MS = 60_000

export function TwitchPoints({ bufferId }: { bufferId: string }): JSX.Element | null {
  const pushed = useChat((s) => s.twitchPoints[bufferId])
  const [open, setOpen] = useState(false)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    let cancelled = false
    setUnavailable(false)
    const ask = (): void => {
      if (document.visibilityState !== 'visible') return
      void window.moho
        .rpc('twitchPoints', { bufferId })
        .catch(() => !cancelled && setUnavailable(true))
    }
    ask()
    const timer = setInterval(ask, REFRESH_MS)
    document.addEventListener('visibilitychange', ask)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', ask)
    }
  }, [bufferId])

  // Closing the channel takes the panel with it.
  useEffect(() => setOpen(false), [bufferId])

  // A channel with no points (or no way to read them) draws nothing rather than a plaque that says nothing.
  if (unavailable && !pushed) return null
  const points = pushed?.points
  const name = pushed?.name || 'points'
  return (
    <div className="kick-points twitch-points">
      <button type="button" className={`kick-points-plaque${open ? ' open' : ''}`} title={`Your channel ${name} here, and what they buy`} onClick={() => setOpen(true)}>
        <Icon name="toll" size={15} />
        <span className="ellipsis">{points === null || points === undefined ? 'Points' : `${points.toLocaleString()} ${name === 'points' ? '' : name}`.trim()}</span>
        <Icon name="redeem" size={15} />
      </button>
      {open && <RewardsPanel bufferId={bufferId} service="twitch" onClose={() => setOpen(false)} onBalance={() => undefined} />}
    </div>
  )
}
