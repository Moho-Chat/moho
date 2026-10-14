import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useChat, useStore } from '../state/hooks'

/**
 * A Twitch channel's points, and the bonus waiting to be claimed.
 *
 * At the foot of the viewer list, where Kick's plaque is. Twitch's points are the person's own twitch.tv
 * session's to see and spend (see nobilis backend/twitch/points.rs), so it is drawn only for an account that has
 * that session, and nothing is read or claimed except by this: the balance once a minute while the window is
 * on this channel, the bonus when its button is pressed. Moho does not send the "watching" reports a points
 * bot would to earn faster.
 */
const REFRESH_MS = 60_000

export function TwitchPoints({ bufferId }: { bufferId: string }): JSX.Element | null {
  const store = useStore()
  const pushed = useChat((s) => s.twitchPoints[bufferId])
  const [busy, setBusy] = useState(false)
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

  const claim = (): void => {
    setBusy(true)
    void window.moho
      .rpc('claimTwitchPoints', { bufferId })
      .then(() => store.toast('info', 'Bonus claimed'))
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  // A channel with no points (or no way to read them) draws nothing rather than a plaque that says nothing.
  if (unavailable && !pushed) return null
  const points = pushed?.points
  const name = pushed?.name || 'points'
  return (
    <div className="kick-points twitch-points">
      {pushed?.claimId && (
        <button type="button" className="button primary twitch-claim" disabled={busy} onClick={claim} title="A bonus is waiting">
          <Icon name="redeem" size={16} /> Claim bonus
        </button>
      )}
      <div className="kick-points-plaque" title={`Your channel ${name} here`}>
        <Icon name="toll" size={15} />
        <span className="ellipsis">{points === null || points === undefined ? 'Points' : `${points.toLocaleString()} ${name === 'points' ? '' : name}`.trim()}</span>
      </div>
    </div>
  )
}
