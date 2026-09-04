import { useEffect, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { classes } from '../lib/util'
import { cardSlot, type LiveCard } from '../state/store'

/**
 * The polls and predictions running in a conversation, over the log.
 *
 * Floating rather than lines in the log, because each is one question being
 * answered over a minute or two while the chat keeps moving underneath it -
 * in the log it would scroll out of reach at exactly the moment somebody
 * wanted to answer it. The log keeps its own record of what was asked; this
 * is the thing you can act on.
 *
 * Not named for a service. Kick is the first to send either, but the shape -
 * a question, a set of answers, a clock - is what Discord and Matrix polls
 * are too, and this draws whatever the daemon hands it.
 */
export function LiveCards({ bufferId }: { bufferId: string }): JSX.Element | null {
  const cards = useChat((s) => s.livePolls)
  const review = useChat((s) => s.reviewCard)
  const poll = cards[cardSlot(bufferId, 'poll')]
  const prediction = cards[cardSlot(bufferId, 'prediction')]
  const reviewing = review && review.bufferId === bufferId ? review : null

  if (!poll && !prediction && !reviewing) return null

  return (
    <div className="poll-stack">
      {reviewing && <Card card={reviewing} reviewing />}
      {poll && <Card card={poll} />}
      {prediction && <Card card={prediction} />}
    </div>
  )
}

/** One card: a poll being voted in, a prediction being backed, or an old one. */
function Card({ card, reviewing = false }: { card: LiveCard; reviewing?: boolean }): JSX.Element | null {
  const store = useStore()
  const hidden = useChat((s) => s.hiddenPolls)
  // Its own clock: `remaining` was the truth when the daemon heard it, and
  // the seconds since then are this component's to count.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (reviewing || card.closed) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [card.id, card.closed, reviewing])

  const elapsed = Math.max(0, (now - card.receivedAt) / 1000)
  const left = reviewing || card.closed ? 0 : Math.max(0, card.remaining - elapsed)
  const open = left > 0
  const isPrediction = card.kind === 'prediction'
  const total = card.options.reduce((sum, o) => sum + o.votes, 0)
  const share = (votes: number): number => (total > 0 ? Math.round((votes / total) * 100) : 0)
  const folded = hidden.includes(card.id)

  // A finished card that has been folded away is finished with: there is
  // nothing left to answer, so a bar offering to bring it back would only be
  // offering an old result.
  if (folded && !open) return null

  const heading = reviewing
    ? isPrediction
      ? 'Past prediction'
      : 'Past poll'
    : open
      ? isPrediction
        ? 'Prediction open'
        : 'Current poll'
      : isPrediction
        ? 'Prediction closed'
        : 'Poll closed'

  if (folded) {
    return (
      <div className="poll-card folded">
        <button type="button" className="poll-unfold" onClick={() => store.showPoll(card.id)} title="Show it again">
          <Icon name={isPrediction ? 'casino' : 'bar_chart'} size={14} />
          <span className="ellipsis">{card.title}</span>
          <span className="small muted">{Math.ceil(left)}s</span>
        </button>
      </div>
    )
  }

  return (
    <div className={classes('poll-card', isPrediction && 'prediction')}>
      <div className="poll-head">
        <div className="poll-heading">
          <div className="small muted">
            {heading}
            {isPrediction && card.total ? ` · ${round(card.total)} points` : ''}
            {reviewing && card.ts ? ` · ${new Date(card.ts * 1000).toLocaleString()}` : ''}
          </div>
          <div className="poll-title ellipsis" title={card.title}>
            {card.title}
          </div>
        </div>
        <div className="poll-buttons">
          {/* Ending it is the streamer's own gesture, and the service refuses
              it for anybody else - so it is offered and allowed to fail there
              rather than guessed at from a role this client may not know. */}
          {!reviewing && !isPrediction && open && (
            <IconButton name="delete" size={16} title="End this poll" onClick={() => store.endPoll(card.bufferId)} />
          )}
          <IconButton
            name={reviewing ? 'close' : 'expand_less'}
            size={16}
            title={reviewing ? 'Done reading' : open ? 'Hide it' : 'Done with it'}
            onClick={() => (reviewing ? store.reviewPoll(null) : store.hidePoll(card.id))}
          />
        </div>
      </div>

      <div className="poll-options">
        {card.options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={classes(
              'poll-option',
              card.votedOptionId === option.id && 'voted',
              option.winner && 'winner',
              !open && 'closed'
            )}
            // Backing a prediction costs points this client has no way to
            // spend, so a prediction's rows are read rather than pressed.
            disabled={reviewing || isPrediction || !open || card.hasVoted}
            onClick={() => store.votePoll(card.bufferId, option.id)}
            title={!reviewing && !isPrediction && open && !card.hasVoted ? `Vote for ${option.label}` : option.label}
          >
            {/* The share as the row's own fill, so the numbers are read twice:
                once as text and once as a length. */}
            <span className="poll-fill" style={{ width: `${share(option.votes)}%` }} />
            <span className="poll-label ellipsis">{option.label}</span>
            {option.winner && <span className="poll-winner small">Winner</span>}
            {option.odds && <span className="poll-odds small muted">{option.odds}</span>}
            <span className="poll-count small">
              {isPrediction ? `${round(option.votes)} · ${share(option.votes)}%` : `${share(option.votes)}% (${option.votes})`}
            </span>
          </button>
        ))}
      </div>

      {card.yourReturn ? <div className="poll-return small">Your return: {round(card.yourReturn)} points</div> : null}

      {/* Time, draining right to left the way the services' own do. Left out
          on something being read back: it has no time left to show. */}
      {!reviewing && (
        <div className="poll-timer" aria-hidden="true">
          <span
            className="poll-timer-fill"
            style={{ width: `${card.duration > 0 ? Math.max(0, Math.min(100, (left / card.duration) * 100)) : 0}%` }}
          />
        </div>
      )}
    </div>
  )
}

/** Points as the services write them: 23.8K rather than 23800. */
function round(points: number): string {
  if (points >= 1_000_000) return `${(points / 1_000_000).toFixed(1)}M`
  if (points >= 1000) return `${(points / 1000).toFixed(1)}K`
  return String(Math.round(points))
}
