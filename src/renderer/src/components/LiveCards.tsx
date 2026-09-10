import { useEffect, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { useChat, usePref, useStore } from '../state/hooks'
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

/**
 * How many folded cards to remember before forgetting the oldest.
 *
 * A busy Kick channel runs a poll every few minutes, and every one folded
 * leaves an id behind. Without a ceiling this is a list that only ever grows,
 * written to disk on every fold. Two hundred is far past any card still on
 * screen - the oldest to go is one whose poll ended long ago.
 */
const REMEMBERED_FOLDS = 200

/** One card: a poll being voted in, a prediction being backed, or an old one. */
function Card({ card, reviewing = false }: { card: LiveCard; reviewing?: boolean }): JSX.Element | null {
  const store = useStore()
  // Persisted rather than held in this window. Folding a card is a decision
  // about that card, and it used to last only as long as the process: a
  // restart brought back every poll somebody had put away, and a popped-out
  // window never knew about a fold made in the main one. Prefs are shared
  // between windows and survive a restart, which is what "folded" should
  // already have meant.
  const [hidden, setHidden] = usePref<string[]>('polls.folded', [])
  const fold = (id: string): void => setHidden([...hidden.filter((k) => k !== id), id].slice(-REMEMBERED_FOLDS))
  const unfold = (id: string): void => setHidden(hidden.filter((k) => k !== id))
  // Its own clock: `remaining` was the truth when the daemon heard it, and
  // the seconds since then are this component's to count.
  const [now, setNow] = useState(() => Date.now())
  /** Which outcome a bet is being put on, and how much. */
  const [picked, setPicked] = useState<string | number | null>(null)
  const [stake, setStake] = useState('')
  useEffect(() => {
    if (reviewing || card.closed) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [card.id, card.closed, reviewing])

  const elapsed = Math.max(0, (now - card.receivedAt) / 1000)
  const left = reviewing || card.closed ? 0 : Math.max(0, card.remaining - elapsed)
  // A clock where the service runs one, and its own word where it does not:
  // a Matrix poll runs until somebody ends it, so a card that worked the
  // answer out from a countdown would open closed.
  const open = reviewing || card.closed ? false : (card.open ?? left > 0)
  const isPrediction = card.kind === 'prediction'
  const total = card.options.reduce((sum, o) => sum + o.votes, 0)
  const share = (votes: number): number => (total > 0 ? Math.round((votes / total) * 100) : 0)
  // Asking to read an old one overrides having folded it away: the fold is
  // how a card is dismissed while it runs, and a review is the deliberate
  // gesture of asking for that same card back.
  const folded = !reviewing && hidden.includes(card.id)

  // A finished card that has been folded away is finished with: there is
  // nothing left to answer, so a bar offering to bring it back would only be
  // offering an old result.
  if (folded && !open) return null

  const amount = Math.floor(Number(stake))
  const canBet =
    picked !== null &&
    Number.isFinite(amount) &&
    amount >= (card.minBet ?? 10) &&
    (card.balance === null || card.balance === undefined || amount <= card.balance)

  const bet = (): void => {
    if (picked === null) {
      store.toast('info', 'Pick an outcome first')
      return
    }
    if (!canBet) {
      store.toast('info', `Bets are ${card.minBet ?? 10} points or more`)
      return
    }
    store.betPrediction(card.bufferId, picked, amount)
    setStake('')
  }

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
        <button type="button" className="poll-unfold" onClick={() => unfold(card.id)} title="Show it again">
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
            onClick={() => (reviewing ? store.reviewPoll(null) : fold(card.id))}
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
              picked === option.id && 'picked',
              option.winner && 'winner',
              !open && 'closed'
            )}
            // A poll row is the vote; a prediction row only chooses what the
            // points go on, because the amount is the other half of a bet.
            disabled={reviewing || !open || (!isPrediction && card.hasVoted)}
            onClick={() =>
              isPrediction ? setPicked(option.id) : store.votePoll(card.bufferId, option.id)
            }
            title={
              reviewing || !open
                ? option.label
                : isPrediction
                  ? `Put points on ${option.label}`
                  : card.hasVoted
                    ? option.label
                    : `Vote for ${option.label}`
            }
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

      {/* What this account already has on it, and what that would come back
          as at the rate the outcome is paying now. Kick marks the same
          number as an estimate while betting is open, because every later
          bet moves it. */}
      {card.stake ? (
        <div className="poll-return small">
          Your bet: {round(card.stake)}
          {card.yourReturn ? ` · would return ${round(card.yourReturn)}${open ? ' at current odds' : ''}` : ''}
        </div>
      ) : null}

      {/* The bet itself. Only while it is taking them, and only where the
          service says what this account has to spend - offering to bet
          points that cannot be counted is offering a button that fails. */}
      {isPrediction && !reviewing && open && (
        <div className="poll-bet">
          <input
            className="poll-bet-amount"
            type="number"
            min={card.minBet ?? 10}
            max={card.balance ?? undefined}
            step={10}
            value={stake}
            placeholder={`${card.minBet ?? 10}+`}
            onChange={(e) => setStake(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && bet()}
          />
          <button type="button" className="button subtle" disabled={!canBet} onClick={bet}>
            Predict
          </button>
          {card.balance !== null && card.balance !== undefined && (
            <span className="small muted">{round(card.balance)} points</span>
          )}
        </div>
      )}

      {/* Time, draining right to left the way the services' own do. Left out
          on something being read back: it has no time left to show. */}
      {!reviewing && card.duration > 0 && (
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
