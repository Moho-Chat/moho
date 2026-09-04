import { useEffect, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { pollKey } from '../state/store'
import { classes } from '../lib/util'

/**
 * The poll running in a Kick channel, over the conversation it belongs to.
 *
 * Floating rather than a line in the log, because a poll is one question
 * being answered over a minute while the chat keeps moving underneath it -
 * pinned to the log it would scroll away mid-vote, which is the one moment it
 * has to be reachable. The log keeps its own record of what was asked and how
 * it went; this is the thing you can actually vote in.
 *
 * Folds away to a single bar rather than closing: a poll somebody has hidden
 * is still running, and hiding it must not look like ending it.
 */
export function PollCard({ bufferId }: { bufferId: string }): JSX.Element | null {
  const store = useStore()
  const poll = useChat((s) => s.kickPolls)[bufferId]
  const hidden = useChat((s) => s.hiddenPolls)
  // Its own clock: `remaining` was the truth when the daemon heard it, and
  // the seconds since then are this component's to count.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!poll) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [poll])

  if (!poll) return null

  const elapsed = Math.max(0, (now - poll.receivedAt) / 1000)
  const left = poll.closed ? 0 : Math.max(0, poll.remaining - elapsed)
  const open = left > 0
  const total = poll.options.reduce((sum, o) => sum + o.votes, 0)
  const share = (votes: number): number => (total > 0 ? Math.round((votes / total) * 100) : 0)
  const key = pollKey(poll)
  const folded = hidden.includes(key)

  // A finished poll that has been folded away is finished with: there is
  // nothing left to answer, so the bar that offers to bring it back would
  // only be offering an old result.
  if (folded && !open) return null

  if (folded) {
    return (
      <div className="poll-card folded">
        <button
          type="button"
          className="poll-unfold"
          onClick={() => store.showPoll(key)}
          title="Show the poll"
        >
          <Icon name="bar_chart" size={14} />
          <span className="ellipsis">{poll.title}</span>
          <span className="small muted">{open ? `${Math.ceil(left)}s` : 'closed'}</span>
        </button>
      </div>
    )
  }

  return (
    <div className="poll-card">
      <div className="poll-head">
        <div className="poll-heading">
          <div className="small muted">{open ? 'Current poll' : 'Poll closed'}</div>
          <div className="poll-title ellipsis" title={poll.title}>
            {poll.title}
          </div>
        </div>
        <div className="poll-buttons">
          {/* Kick refuses this for anybody who is not the streamer or one of
              their moderators, so it is offered and allowed to fail there
              rather than guessed at from a role this client may not know. */}
          <IconButton name="delete" size={16} title="End this poll" onClick={() => store.endKickPoll(bufferId)} />
          <IconButton
            name="expand_less"
            size={16}
            title={open ? 'Hide the poll' : 'Done with this poll'}
            onClick={() => store.hidePoll(key)}
          />
        </div>
      </div>

      <div className="poll-options">
        {poll.options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={classes('poll-option', poll.votedOptionId === option.id && 'voted', !open && 'closed')}
            // Voting twice is Kick's to refuse, and it does - but a button
            // that has already been used should not invite the click.
            disabled={!open || poll.hasVoted}
            onClick={() => store.voteKickPoll(bufferId, option.id)}
            title={open && !poll.hasVoted ? `Vote for ${option.label}` : option.label}
          >
            {/* The share as the row's own fill, so the numbers are read
                twice: once as text and once as a length. */}
            <span className="poll-fill" style={{ width: `${share(option.votes)}%` }} />
            <span className="poll-label ellipsis">{option.label}</span>
            <span className="poll-count small">
              {share(option.votes)}% ({option.votes})
            </span>
          </button>
        ))}
      </div>

      {/* Time, draining right to left the way Kick's own does. */}
      <div className="poll-timer" aria-hidden="true">
        <span
          className="poll-timer-fill"
          style={{ width: `${poll.duration > 0 ? Math.max(0, Math.min(100, (left / poll.duration) * 100)) : 0}%` }}
        />
      </div>
    </div>
  )
}
