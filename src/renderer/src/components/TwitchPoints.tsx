import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useChat } from '../state/hooks'

/**
 * A Twitch channel's points balance.
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

  // A channel with no points (or no way to read them) draws nothing rather than a plaque that says nothing.
  if (unavailable && !pushed) return null
  const points = pushed?.points
  const name = pushed?.name || 'points'
  return (
    <div className="kick-points twitch-points">
      <div className="kick-points-plaque" title={`Your channel ${name} here`}>
        <Icon name="toll" size={15} />
        <span className="ellipsis">{points === null || points === undefined ? 'Points' : `${points.toLocaleString()} ${name === 'points' ? '' : name}`.trim()}</span>
      </div>
    </div>
  )
}
