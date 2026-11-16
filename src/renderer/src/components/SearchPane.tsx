import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, IconButton } from './Icon'
import { Avatar } from './Avatar'
import { useChat, usePref } from '../state/hooks'
import { accountOfBuffer } from '../lib/route'
import { bufferDisplayName, classes, dayLabel, dayOf, formatFullTime, formatTime } from '../lib/util'
import { isRoomEvent, markMatches } from '../lib/searchmarks'
import type { Message } from '../../../shared/wire'

/** The id of the column App keeps for results while a search has any. */
export const SEARCH_PANE_HOST = 'search-pane-host'

/**
 * What a search found, in the column beside the conversation (#339).
 *
 * Beside it rather than over it: the log being searched stays readable, a
 * result can be gone to and the next one tried without the list closing, and
 * a result is drawn as the message it is - who, when, and the words with the
 * match marked - rather than as a line in a menu.
 *
 * Drawn here and placed by App, which owns the column: the search itself
 * lives with the box in the header, and hands its results over.
 */
export function SearchPane({
  query,
  results,
  total,
  searching,
  jumping,
  here,
  roomNames,
  notes,
  onJump,
  onClose
}: {
  query: string
  results: Message[]
  /** How many the server says there are, where it says. */
  total: number | null
  searching: boolean
  jumping: boolean
  /** The conversation being searched, so a result from another can say where it is. */
  here: string
  roomNames: Record<string, string>
  /** What the service had to say about the search: still indexing, encrypted. */
  notes: string[]
  onJump: (m: Message) => void
  onClose: () => void
}): JSX.Element | null {
  const open = useChat((s) => s.searchPane)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [events, setEvents] = usePref<boolean>('search.roomEvents', false)
  // The column is App's, and is there a frame after the store says so.
  useEffect(() => {
    setHost(open ? document.getElementById(SEARCH_PANE_HOST) : null)
  }, [open])
  if (!host) return null

  const hidden = results.filter(isRoomEvent).length
  const shown = events ? results : results.filter((m) => !isRoomEvent(m))
  const days: { day: number; label: string; items: Message[] }[] = []
  for (const m of shown) {
    const day = dayOf(m.ts)
    const last = days[days.length - 1]
    if (last && last.day === day) last.items.push(m)
    else days.push({ day, label: dayLabel(m.ts), items: [m] })
  }

  return createPortal(
    <>
      <div className="search-pane-head">
        <div className="search-pane-title">
          <Icon name="search" size={16} />
          <span className="ellipsis" title={query}>
            {query.trim()}
          </span>
          <IconButton name="close" size={16} title="Close the search" onClick={onClose} />
        </div>
        <div className="small muted">
          {searching
            ? 'Searching…'
            : jumping
              ? 'Loading older messages…'
              : total !== null && total > shown.length
                ? // What the server found, not what it sent: a search
                  // answering "25 results" when there are thousands is
                  // a wrong answer to "how much is there".
                  `${shown.length} of ${total.toLocaleString()} results`
                : `${shown.length} ${shown.length === 1 ? 'result' : 'results'}`}
        </div>
        {notes.map((note) => (
          <div key={note} className="small muted search-pane-note">
            {note}
          </div>
        ))}
      </div>

      <div className="search-pane-rows">
        {days.map((group) => (
          <div key={group.day}>
            <div className="date-divider" role="separator">
              <span>{group.label}</span>
            </div>
            {group.items.map((m) => (
              <button key={`${m.bufferId}|${m.id}`} type="button" className={classes('search-hit', isRoomEvent(m) && 'event')} onClick={() => onJump(m)}>
                <Avatar name={m.from} url={m.avatarUrl} size={28} accountId={accountOfBuffer(m.bufferId || here)} />
                <span className="search-hit-body">
                  <span className="search-hit-head small">
                    <span className="search-hit-from ellipsis">{m.from}</span>
                    <span className="muted search-hit-when" title={formatFullTime(m.ts)}>
                      {formatTime(m.ts)}
                    </span>
                  </span>
                  {m.bufferId && m.bufferId !== here && (
                    <span className="small muted ellipsis">in {roomNames[m.bufferId] || bufferDisplayName(m.bufferId)}</span>
                  )}
                  <span className="search-hit-text small">
                    {markMatches(m.body, query).map((part, i) => (part.hit ? <mark key={i}>{part.text}</mark> : part.text))}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ))}
        {!searching && shown.length === 0 && (
          <div className="search-pane-empty small muted">
            {hidden > 0 ? 'Only people coming and going matched.' : 'Nothing found.'}
          </div>
        )}
      </div>

      {/* Asked for, not assumed: a name searched for matches every time its owner walked in. */}
      {(hidden > 0 || events) && (
        <label className="search-pane-foot small">
          <span className="muted">
            Include joins and parts{hidden > 0 && !events ? ` (${hidden})` : ''}
          </span>
          <button type="button" role="switch" aria-checked={events} className={classes('switch', events && 'on')} onClick={() => setEvents(!events)}>
            <span className="switch-knob" />
          </button>
        </label>
      )}
    </>,
    host
  )
}
