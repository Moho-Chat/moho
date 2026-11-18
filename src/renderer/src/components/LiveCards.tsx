import { useEffect, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { useChat, usePref, useStore } from '../state/hooks'
import { classes } from '../lib/util'
import { cardSlot, type LiveCard, type LiveCardOption } from '../state/store'
import { fractionOf, pollWinners, stageOf } from '../lib/livecards'

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
      {/* Keyed by the card, so a new poll or prediction starts with nothing picked and an empty amount. */}
      {reviewing && <Card key={`r${reviewing.id}`} card={reviewing} reviewing />}
      {poll && <Card key={poll.id} card={poll} />}
      {prediction && <Card key={prediction.id} card={prediction} />}
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

/**
 * The colours outcomes are told apart by, in order (#339). Two answers are blue and pink, facing each other; more
 * take the rest in turn. An outcome keeps its colour from the first moment to the result.
 */
const TWO = ['#42a5f5', '#ec407a']
const MANY = ['#42a5f5', '#ab47bc', '#26a69a', '#ef6c00', '#ec407a', '#9ccc65', '#ffca28', '#5c6bc0', '#8d6e63', '#78909c']

const FRACTIONS: [string, number][] = [
  ['⅛', 1 / 8],
  ['¼', 1 / 4],
  ['½', 1 / 2],
  ['All', 1]
]

/** One card: a poll being voted in, a prediction being backed, or an old one. */
function Card({ card, reviewing = false }: { card: LiveCard; reviewing?: boolean }): JSX.Element | null {
  const store = useStore()
  const [hidden, setHidden] = usePref<string[]>('polls.folded', [])
  const fold = (id: string): void => setHidden([...hidden.filter((k) => k !== id), id].slice(-REMEMBERED_FOLDS))
  const unfold = (id: string): void => setHidden(hidden.filter((k) => k !== id))
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
  const open = reviewing || card.closed ? false : (card.open ?? left > 0)
  const isPrediction = card.kind === 'prediction'
  const stage = stageOf(card, open)
  const taking = stage === 'open' && !reviewing
  const total = card.options.reduce((sum, o) => sum + o.votes, 0)
  const share = (votes: number): number => (total > 0 ? Math.round((votes / total) * 100) : 0)
  const folded = !reviewing && hidden.includes(card.id)
  const two = card.options.length === 2
  const colourOf = (i: number): string => (two ? TWO[i] : MANY[i % MANY.length])
  const mine = (id: string | number): boolean =>
    String(card.votedOptionId) === String(id) || !!card.votedOptionIds?.some((v) => String(v) === String(id))
  const winners = stage === 'decided' ? (isPrediction ? card.options.filter((o) => o.winner).map((o) => o.id) : pollWinners(card)) : []
  const won = (id: string | number): boolean => winners.some((w) => String(w) === String(id))

  if (folded && stage !== 'open') return null

  const minBet = card.minBet ?? 10
  const amount = Math.floor(Number(stake))
  // Once points are on an outcome, more can only go on that one.
  const target = isPrediction ? (card.votedOptionId ?? picked) : null
  const targetOption = card.options.find((o) => String(o.id) === String(target))
  const canBet =
    target !== null &&
    target !== undefined &&
    Number.isFinite(amount) &&
    amount >= minBet &&
    (card.balance === null || card.balance === undefined || amount <= card.balance)

  const bet = (): void => {
    if (target === null || target === undefined) {
      store.toast('info', 'Pick an outcome first')
      return
    }
    if (!canBet) {
      store.toast('info', `Bets are ${minBet} points or more`)
      return
    }
    store.betPrediction(card.bufferId, target, amount)
    setStake('')
  }

  /** What pressing an answer does: a prediction's chooses where points would go; a poll's is the vote. */
  const choose = (id: string | number): void => {
    if (!taking || card.readOnly) return
    if (isPrediction) {
      if (card.votedOptionId === null || card.votedOptionId === undefined) setPicked(id)
      return
    }
    if (card.hasVoted && !card.changeable && !card.multiple) return
    if (!card.multiple) return store.votePoll(card.bufferId, id)
    const chosen = (card.votedOptionIds ?? []).map(String)
    store.votePollAnswers(card.bufferId, chosen.includes(String(id)) ? chosen.filter((p) => p !== String(id)) : [...chosen, String(id)])
  }
  const clickable = taking && !card.readOnly && (isPrediction ? card.votedOptionId === null || card.votedOptionId === undefined : !card.hasVoted || !!card.changeable || !!card.multiple)

  const icon = isPrediction ? 'casino' : 'bar_chart'

  if (folded) {
    return (
      <div className="poll-card folded">
        <button type="button" className="poll-unfold" onClick={() => unfold(card.id)} title="Show it again">
          <Icon name={icon} size={14} />
          <span className="ellipsis">{card.title}</span>
          {left > 0 && <span className="small muted">{clock(left)}</span>}
        </button>
      </div>
    )
  }

  const when =
    stage !== 'open'
      ? null
      : left > 0
        ? clock(left)
        : null
  const steps: { id: string; word: string; icon: string }[] = isPrediction
    ? [
        { id: 'open', word: 'Open', icon: 'radio_button_checked' },
        { id: 'locked', word: 'Locked', icon: 'lock' },
        { id: 'decided', word: stage === 'cancelled' ? 'Called off' : 'Decided', icon: stage === 'cancelled' ? 'block' : 'verified' }
      ]
    : [
        { id: 'open', word: 'Open', icon: 'radio_button_checked' },
        { id: 'decided', word: 'Ended', icon: 'flag' }
      ]
  // Which step it is at: a poll has two, a prediction three (called off is its last).
  const at = isPrediction ? (stage === 'open' ? 0 : stage === 'locked' ? 1 : 2) : stage === 'open' ? 0 : 1
  const people = card.options.reduce((sum, o) => sum + (o.backers ?? 0), 0)
  const summary = isPrediction
    ? [card.total ? `${round(card.total)} points` : null, people ? `${round(people)} people` : null].filter(Boolean).join(' · ')
    : [card.multiple ? 'pick several' : null, `${total} ${total === 1 ? 'vote' : 'votes'}`].filter(Boolean).join(' · ')

  const stats = (o: LiveCardOption): string =>
    isPrediction ? [`${round(o.votes)} pts`, o.odds].filter(Boolean).join(' · ') : `${o.votes} ${o.votes === 1 ? 'vote' : 'votes'}`

  return (
    <div className={classes('poll-card', isPrediction && 'prediction', `stage-${stage}`)}>
      <div className="lc-head">
        <Icon name={icon} size={18} className={isPrediction ? 'lc-icon bet' : 'lc-icon'} />
        <div className="lc-title" title={card.title}>
          {card.title}
        </div>
        {/* Ending it is the owner's own gesture, and the service refuses it for anybody else - so it is offered and
            allowed to fail there rather than guessed at from a role this client may not know. */}
        {taking && !isPrediction && !card.readOnly && !card.noEnd && (
          <button type="button" className="button quiet small" onClick={() => store.endPoll(card.bufferId, card.id)}>
            End poll
          </button>
        )}
        <IconButton
          name={reviewing ? 'close' : taking || stage === 'locked' ? 'expand_less' : 'close'}
          size={16}
          title={reviewing ? 'Done reading' : taking ? 'Hide it' : 'Done with it'}
          onClick={() => (reviewing ? store.reviewPoll(null) : fold(card.id))}
        />
      </div>

      {/* Where it is: the steps it goes through, this one in bold. */}
      <div className="lc-steps small">
        {steps.map((step, i) => (
          <span key={step.id} className="lc-step-wrap">
            {i > 0 && <span className="lc-step-line" />}
            <span className={classes('lc-step', i === at && 'on', i < at && 'done')}>
              <Icon name={i < at ? 'check' : step.icon} size={14} fill={i === at} />
              {step.word}
              {i === at && step.id === 'open' && when ? ` · ${when}` : ''}
            </span>
          </span>
        ))}
        <span className="lc-spacer" />
        <span className="muted">
          {reviewing && card.ts ? `${new Date(card.ts * 1000).toLocaleString()} · ` : ''}
          {summary}
        </span>
      </div>
      {taking && card.duration > 0 && left > 0 && (
        <div className="lc-time" aria-hidden="true">
          <span style={{ width: `${Math.max(0, Math.min(100, (left / card.duration) * 100))}%` }} />
        </div>
      )}

      {/* What came of it. */}
      {stage === 'cancelled' && (
        <div className="lc-banner">
          <Icon name="block" size={24} />
          <div>
            <b>Called off</b>
            <span className="small muted">{card.stake ? `Your ${exact(card.stake)} points were refunded` : 'Every bet was refunded'}</span>
          </div>
        </div>
      )}
      {stage === 'decided' && winners.length > 0 && (() => {
        const names = card.options.filter((o) => won(o.id)).map((o) => o.label)
        const head = names.length > 1 ? `A tie: ${names.join(' and ')}` : `${names[0]} won`
        const mineOption = card.options.find((o) => mine(o.id))
        const iWon = !!mineOption && won(mineOption.id)
        const line = isPrediction
          ? mineOption && card.stake
            ? iWon
              ? `You put ${exact(card.stake)} on ${mineOption.label}`
              : `Your ${exact(card.stake)} on ${mineOption.label} is gone`
            : `${card.total ? round(card.total) : 'No'} points were bet`
          : mineOption
            ? iWon
              ? `Your answer won · ${total} ${total === 1 ? 'person' : 'people'} voted`
              : `You voted ${mineOption.label} · ${total} ${total === 1 ? 'person' : 'people'} voted`
            : `${total} ${total === 1 ? 'person' : 'people'} voted`
        const title = isPrediction && iWon && card.stake ? `${head}: you got ${card.yourReturn ? exact(card.yourReturn) : 'your winnings'} back` : !isPrediction && names.length === 1 ? `${head}, ${share(card.options.find((o) => won(o.id))?.votes ?? 0)}%` : head
        return (
          <div className={classes('lc-banner', iWon && 'won')}>
            <Icon name={isPrediction ? (iWon ? 'emoji_events' : 'sentiment_dissatisfied') : 'how_to_vote'} size={24} fill={iWon} />
            <div>
              <b>{title}</b>
              <span className="small muted">{line}</span>
            </div>
          </div>
        )
      })()}

      {two ? (
        <>
          <div className="lc-vs">
            {card.options.map((o, i) => {
              const ended = stage === 'decided' && winners.length > 0
              return (
                <button
                  key={o.id}
                  type="button"
                  className={classes(
                    'lc-side',
                    i === 1 && 'right',
                    (picked === o.id || mine(o.id)) && stage !== 'decided' && 'chosen',
                    ended && won(o.id) && 'win',
                    ended && !won(o.id) && 'lose'
                  )}
                  style={{ '--c': colourOf(i) } as React.CSSProperties}
                  disabled={!clickable}
                  onClick={() => choose(o.id)}
                  title={clickable ? (isPrediction ? `Put points on ${o.label}` : `Vote for ${o.label}`) : o.label}
                >
                  <span className="lc-side-name">
                    {ended && won(o.id) && <Icon name="check_circle" size={15} fill className="lc-win-mark" />}
                    {o.label}
                  </span>
                  <span className="lc-big">{share(o.votes)}%</span>
                  <span className="lc-meta">{stats(o)}</span>
                  {!!o.backers && <span className="lc-meta">{round(o.backers)} people</span>}
                  {mine(o.id) ? (
                    <span className="lc-note">{isPrediction ? 'Your bet' : 'Your vote'}</span>
                  ) : clickable && !isPrediction ? (
                    <span className="lc-note">Click to vote</span>
                  ) : null}
                </button>
              )
            })}
            <span className="lc-versus">VS</span>
          </div>
        </>
      ) : (
        <div className="lc-rows">
          {card.options.map((o, i) => {
            const ended = stage === 'decided' && winners.length > 0
            return (
              <button
                key={o.id}
                type="button"
                className={classes(
                  'lc-row',
                  (picked === o.id || mine(o.id)) && stage !== 'decided' && 'chosen',
                  ended && won(o.id) && 'win',
                  ended && !won(o.id) && 'lose'
                )}
                style={{ '--c': colourOf(i) } as React.CSSProperties}
                disabled={!clickable}
                onClick={() => choose(o.id)}
                title={clickable ? (isPrediction ? `Put points on ${o.label}` : `Vote for ${o.label}`) : o.label}
              >
                <span className="lc-fill" style={{ width: `${share(o.votes)}%` }} />
                {!isPrediction && taking && <span className={classes('lc-mark', card.multiple && 'square', mine(o.id) && 'on')} />}
                <span className="lc-swatch" />
                <span className="lc-label ellipsis">
                  {ended && won(o.id) && <Icon name="check_circle" size={15} fill className="lc-win-mark" />}
                  {o.label}
                  {mine(o.id) && (stage !== 'open' || isPrediction) && <span className="small muted"> {isPrediction ? 'your bet' : 'your vote'}</span>}
                </span>
                <span className="lc-num small">{isPrediction ? round(o.votes) : o.votes}</span>
                <span className="lc-pct small">{share(o.votes)}%</span>
                {o.odds && <span className="lc-odds small">{o.odds}</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* Every share in one bar, in the outcomes' colours. */}
      <div className="lc-split" aria-hidden="true">
        {card.options.map((o, i) => (
          <span
            key={o.id}
            style={{
              width: total > 0 ? `${(o.votes / total) * 100}%` : `${100 / card.options.length}%`,
              background: colourOf(i),
              opacity: total === 0 || (stage === 'decided' && winners.length > 0 && !won(o.id)) ? 0.35 : 1
            }}
          />
        ))}
      </div>

      {/* What this account has on it, and what that would come back as at the rate the outcome is paying now. */}
      {isPrediction && card.stake && stage !== 'decided' && stage !== 'cancelled' ? (
        <div className={classes('lc-mine small', stage === 'locked' && 'locked')}>
          {stage === 'locked' && <Icon name="lock" size={15} />}
          <span className="lc-spacer-inline">
            Your {exact(card.stake)} on{' '}
            <b style={{ color: `color-mix(in srgb, ${colourOf(card.options.findIndex((o) => mine(o.id)))} 70%, white)` }}>{targetOption?.label}</b>
          </span>
          {card.yourReturn ? (
            <span className="muted">
              returns ~{exact(card.yourReturn)}
              {stage === 'locked' ? ' if it wins' : ''}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* The bet itself: an amount, or a share of what there is to bet, and one button saying where it goes. Only
          while it is taking them. */}
      {isPrediction && taking && !card.readOnly && (
        <>
          <div className="lc-stake">
            <label className="lc-amount">
              <Icon name="toll" size={16} fill />
              <input
                type="number"
                min={minBet}
                max={card.balance ?? undefined}
                step={10}
                value={stake}
                placeholder={`Amount (${minBet} or more)`}
                onChange={(e) => setStake(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && bet()}
              />
            </label>
            {card.balance !== null && card.balance !== undefined && card.balance >= minBet &&
              FRACTIONS.map(([word, part]) => {
                const value = fractionOf(card.balance as number, part, minBet)
                return (
                  <button
                    key={word}
                    type="button"
                    className={classes('lc-chip', amount === value && 'on')}
                    title={`${value.toLocaleString()} points`}
                    onClick={() => setStake(String(value))}
                  >
                    {word}
                  </button>
                )
              })}
          </div>
          <div className="lc-stake">
            <span className="small muted lc-spacer-inline">
              {card.balance !== null && card.balance !== undefined ? `You have ${exact(card.balance)}` : ''}
              {targetOption && amount >= minBet && targetOption.odds ? ` · ${amount.toLocaleString()} on ${targetOption.label} pays ${targetOption.odds}` : ''}
            </span>
            <button type="button" className="button primary" disabled={!canBet} onClick={bet}>
              {targetOption ? `Bet on ${targetOption.label}` : 'Pick an outcome'}
            </button>
          </div>
        </>
      )}

      {!isPrediction && taking && card.hasVoted && card.changeable && !card.multiple && (
        <div className="small muted">Click another answer to change your vote.</div>
      )}
    </div>
  )
}

/** This account's own points, exactly: 12,840. */
function exact(points: number): string {
  return Math.round(points).toLocaleString()
}

/** Seconds left, as a clock: 0:42, 12:05. */
function clock(seconds: number): string {
  const s = Math.ceil(seconds)
  if (s >= 86400) return `${Math.floor(s / 86400)} days left`
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Points as the services write them: 23.8K rather than 23800. */
function round(points: number): string {
  if (points >= 1_000_000) return `${(points / 1_000_000).toFixed(1)}M`
  if (points >= 1000) return `${(points / 1000).toFixed(1)}K`
  return String(Math.round(points))
}
