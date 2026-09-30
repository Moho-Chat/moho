import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { formatFullTime, formatTime, nickColor } from '../lib/util'

interface Summary {
  roomId: string
  name: string
  topic: string
  alias: string
  members: number
  joinRule: string
  membership: string
  encrypted: boolean
  worldReadable: boolean
}

interface PeekLine {
  id: string
  from: string
  body: string
  isAction: boolean
  ts: number
}

/**
 * A look inside a room nobody here has joined, in the place a room is read.
 *
 * This used to open inside the search dialog, under the row it was about -
 * which put a conversation in a window built for choosing one, and left the
 * log somewhere it could not be read the way a log is read. It stands where
 * the conversation would instead: the same pane, the same row layout, and
 * nothing to type into, because there is nobody here to say it as.
 *
 * Joining is a membership event everybody in the room can see, and leaving
 * again leaves both of them behind - so looking and joining are separate acts,
 * and the bar under this says which of the two this is.
 *
 * Two halves, because homeservers permit them separately. The summary is
 * answered for any room the server can reach; the conversation needs the room
 * to be world-readable *and* this homeserver to hold a copy of it. Where it
 * does not, that is said in as many words, because silence there reads as an
 * empty room rather than as a door that is shut.
 */
export function PeekView(): JSX.Element | null {
  const peek = useChat((s) => s.peek)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [lines, setLines] = useState<PeekLine[] | null>(null)
  const [failed, setFailed] = useState('')
  const [refused, setRefused] = useState('')
  const scroller = useRef<HTMLDivElement>(null)

  const accountId = peek?.accountId
  const roomId = peek?.roomId
  const via = peek?.via

  useEffect(() => {
    if (!accountId || !roomId) return
    // Whatever was on screen belongs to the room before this one.
    setSummary(null)
    setLines(null)
    setFailed('')
    setRefused('')
    let current = true
    void window.moho
      .rpc<Summary>('matrixRoomSummary', { accountId, room: roomId, via: via ? [via] : [] })
      .then((answer) => {
        if (!current) return
        setSummary(answer)
        // Only worth asking where the room itself would allow it - a room
        // that is not world-readable refuses however willing the homeserver
        // is, and an error for that would blame the wrong thing.
        if (!answer.worldReadable) return
        void window.moho
          .rpc<{ messages: PeekLine[] }>('matrixPeekRoom', {
            accountId,
            roomId: answer.roomId,
            limit: 50
          })
          .then((r) => current && setLines(r.messages ?? []))
          .catch((e: Error) => current && setRefused(e.message))
      })
      .catch((e: Error) => current && setFailed(e.message))
    return () => {
      current = false
    }
  }, [accountId, roomId, via])

  // A log is read from its end.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  if (!peek) return null

  return (
    <div className="peek-view">
      {summary && (
        <div className="peek-facts small muted">
          {summary.members.toLocaleString()} members
          {summary.joinRule === 'knock'
            ? ' · asks to be knocked on'
            : summary.joinRule === 'restricted'
              ? ' · open to a space’s members'
              : summary.joinRule === 'invite'
                ? ' · invitation only'
                : ''}
          {summary.encrypted ? ' · encrypted' : ''}
          {peek.via ? ` · ${peek.via}` : ''}
        </div>
      )}

      {summary?.topic && <div className="peek-topic small">{summary.topic}</div>}

      <div className="peek-log" ref={scroller}>
        {!summary && !failed && (
          <div className="messagelist-empty muted">
            <span className="spinner" />
            <span>Looking…</span>
          </div>
        )}
        {failed && <div className="messagelist-empty muted">Couldn’t look: {failed}</div>}

        {summary && !summary.worldReadable && (
          <div className="messagelist-empty muted">
            This room’s history is only for people who have joined it, so there is nothing to read
            from out here.
          </div>
        )}
        {refused && <div className="messagelist-empty muted">{refused}</div>}
        {summary?.worldReadable && !lines && !refused && (
          <div className="messagelist-empty muted">
            <span className="spinner" />
            <span>Reading the latest messages…</span>
          </div>
        )}
        {lines?.length === 0 && (
          <div className="messagelist-empty muted">Nothing has been said here.</div>
        )}

        {/* The same row the log draws, without what acts on a message: nothing
            here can be replied to, reacted to or quoted from a room you are
            not in. */}
        {lines?.map((line) => (
          <div key={line.id} className="message-row">
            <span className="message-time small muted" title={formatFullTime(line.ts)}>
              {formatTime(line.ts)}
            </span>
            <div className="message-content">
              <span className="message-byline">
                <span className="message-from" style={{ color: nickColor(line.from) }}>
                  {line.isAction ? `* ${line.from}` : line.from}
                </span>
              </span>
              <span className="message-body selectable">{line.body}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Where the box would be, while a room is only being looked at.
 *
 * There is nobody here to say anything as, so the box is not offered - this
 * stands in its place and says what the pane is, with the one thing that
 * turns it into a conversation. Pressing Join takes the banner away and puts
 * the box back, inert until the room has actually arrived: the box belongs to
 * a conversation, and the room is not one for the moment or two the server
 * takes to let somebody in.
 */
export function PeekBar(): JSX.Element | null {
  const store = useStore()
  const peek = useChat((s) => s.peek)
  if (!peek) return null
  const title = peek.name || peek.alias || peek.roomId

  if (peek.joining) {
    return (
      <div className="composer">
        <div className="divider-h" />
        <div className="composer-row">
          <div className="composer-input-wrap">
            <div className="text-field composer-input muted" aria-disabled="true">
              Joining {title}…
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="peek-bar">
      <div className="divider-h" />
      <div className="peek-bar-row">
        <Icon name="visibility" size={16} />
        <div className="peek-bar-text">
          <span>
            You’re looking at <strong>{title}</strong> without having joined it.
          </span>
          <span className="small muted">Nobody in it can see you here.</span>
        </div>
        {peek.joinRule !== 'knock' && (
          <button
            type="button"
            className="button"
            onClick={() => void store.joinPeeked().catch((e: Error) => store.toast('error', e.message))}
          >
            Join
          </button>
        )}
        <button type="button" className="button subtle" onClick={() => store.stopPeek()}>
          Stop looking
        </button>
      </div>
    </div>
  )
}
