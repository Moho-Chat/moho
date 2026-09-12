import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { useStore } from '../state/hooks'

/**
 * Channel points, and what the streamer will trade them for.
 *
 * A plaque at the foot of the viewer list, because that is where Kick puts it
 * and because it belongs to the channel rather than to the conversation - it
 * is a fact about standing in this room, like the viewer count above it.
 *
 * The list opens upward. The plaque sits at the bottom of a full-height
 * column, so a pane growing downward from it would be drawn mostly off the
 * window; anchoring it to the plaque's top edge and letting it grow up is the
 * only direction with room. Its height is capped and it scrolls, because a
 * channel may offer more rewards than the window is tall.
 */
interface Reward {
  id: string
  title: string
  cost: number
  description?: string
  enabled: boolean
  paused: boolean
  needsInput: boolean
}

/** How often the balance is asked for while this channel is on screen. */
const POINTS_INTERVAL_MS = 60_000

interface Answer {
  rewards: Reward[]
  points: number | null
}

export function KickPoints({ bufferId }: { bufferId: string }): JSX.Element | null {
  const store = useStore()
  const [open, setOpen] = useState(false)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [busy, setBusy] = useState('')
  const box = useRef<HTMLDivElement>(null)

  const [points, setPoints] = useState<number | null>(null)

  const refresh = (): void => {
    void window.moho
      .rpc<Answer>('listKickRewards', { bufferId })
      .then((a) => {
        setAnswer(a)
        if (a.points !== null) setPoints(a.points)
      })
      .catch(() => setAnswer(null))
  }

  // The balance, shown whether or not the pane is open, and kept current
  // while somebody is actually looking at this channel.
  //
  // Only while looking: this component exists only for the conversation on
  // screen, so a channel scrolled away from stops costing anything the moment
  // it is closed. A poll per open channel would be a request a minute for
  // every Kick channel an account watches, forever, to keep numbers nobody is
  // reading up to date.
  //
  // Paused with the window too. A minimised client is not somebody watching,
  // and points that are a few minutes stale when the window comes back are
  // corrected by the next tick before anyone could spend them.
  useEffect(() => {
    let cancelled = false
    const ask = (): void => {
      if (document.visibilityState !== 'visible') return
      void window.moho
        .rpc<{ points: number }>('kickPoints', { bufferId })
        .then((a) => !cancelled && setPoints(a.points))
        // A channel that will not say leaves the last number rather than
        // blanking the plaque - it was true a minute ago, which is closer
        // than nothing.
        .catch(() => {})
    }
    setPoints(null)
    ask()
    const timer = setInterval(ask, POINTS_INTERVAL_MS)
    // Coming back to the window should not wait out the rest of a minute.
    document.addEventListener('visibilitychange', ask)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', ask)
    }
  }, [bufferId])

  // The rest - what the points can buy - only when the pane is opened. A
  // channel's rewards are set up once and edited rarely, so asking for them
  // every minute would be a request spent on an answer that does not change.
  useEffect(() => {
    if (open) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bufferId])

  // Closing the channel takes the pane with it, so it cannot be left open
  // over a conversation it is not about.
  useEffect(() => setOpen(false), [bufferId])

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', away)
    window.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', key)
    }
  }, [open])


  const redeem = (reward: Reward): void => {
    setBusy(reward.id)
    void window.moho
      .rpc<{ points: number | null }>('redeemKickReward', { bufferId, rewardId: reward.id })
      .then((a) => {
        store.toast('info', `Redeemed ${reward.title}`)
        // The balance the server now holds, rather than this one minus the
        // cost - a redeem that was refunded or cost something else should not
        // leave the plaque disagreeing with Kick.
        if (a.points !== null) setPoints(a.points)
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(''))
  }

  return (
    <div className="kick-points" ref={box}>
      {open && (
        <div className="kick-rewards" role="menu">
          <div className="kick-rewards-head small muted">
            {answer ? `${answer.rewards.length} rewards` : 'Asking Kick…'}
          </div>
          <div className="kick-rewards-list">
            {answer?.rewards.map((r) => {
              // Shown whatever their state - the list is also how somebody
              // learns what this channel does - but only one of them can
              // actually be pressed.
              const why = !r.enabled
                ? 'The streamer has this turned off'
                : r.paused
                  ? 'Paused right now'
                  : r.needsInput
                    ? 'This one asks you to type something, which moho cannot do yet'
                    : points !== null && points < r.cost
                      ? `You have ${points.toLocaleString()} of ${r.cost.toLocaleString()}`
                      : ''
              return (
                <button
                  key={r.id}
                  type="button"
                  className={`kick-reward${why ? ' locked' : ''}`}
                  disabled={!!why || busy === r.id}
                  title={why || r.description || r.title}
                  onClick={() => redeem(r)}
                >
                  <span className="ellipsis">{r.title}</span>
                  <span className="kick-reward-cost small">{r.cost.toLocaleString()}</span>
                </button>
              )
            })}
            {answer?.rewards.length === 0 && (
              <div className="small muted kick-rewards-empty">This channel offers nothing for points.</div>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        className={`kick-points-plaque${open ? ' open' : ''}`}
        title="Channel points, and what they buy"
        onClick={() => setOpen(!open)}
      >
        <Icon name="toll" size={15} />
        <span className="ellipsis">{points === null ? 'Points' : points.toLocaleString()}</span>
        <Icon name={open ? 'expand_more' : 'expand_less'} size={15} />
      </button>
    </div>
  )
}
