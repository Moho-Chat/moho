import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { formatTime } from '../lib/util'
import type { Account } from '../../../shared/wire'

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
 * A look inside a room nobody here has joined.
 *
 * Joining is a membership event everybody in the room can see, and leaving
 * again leaves both of them behind - so without this, the decision to look
 * and the decision to join were the same act.
 *
 * Two halves, because homeservers permit them separately. The summary -
 * topic, size, how the room is entered, whether it is encrypted - is
 * answered for any room the server can reach, and is most of what somebody
 * decides on. The conversation needs the room to be world-readable *and* the
 * homeserver to allow peeking at all, which many do not; where it refuses,
 * that is said in as many words, because silence there reads as an empty
 * room rather than as a door that is shut.
 */
export function RoomPeek({
  account,
  room,
  via,
  onClose
}: {
  account: Account
  room: string
  via?: string
  onClose: () => void
}): JSX.Element {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [lines, setLines] = useState<PeekLine[] | null>(null)
  const [failed, setFailed] = useState('')
  const [refused, setRefused] = useState('')

  useEffect(() => {
    void window.moho
      .rpc<Summary>('matrixRoomSummary', { accountId: account.id, room, via: via ? [via] : [] })
      .then((answer) => {
        setSummary(answer)
        // Only worth asking where the room itself would allow it - a room
        // that is not world-readable refuses however willing the homeserver
        // is, and an error for that would blame the wrong thing.
        if (!answer.worldReadable) return
        void window.moho
          .rpc<{ messages: PeekLine[] }>('matrixPeekRoom', {
            accountId: account.id,
            roomId: answer.roomId,
            limit: 20
          })
          .then((r) => setLines(r.messages))
          .catch((e: Error) => setRefused(e.message))
      })
      .catch((e: Error) => setFailed(e.message))
  }, [account.id, room])

  return (
    <div className="room-peek">
      <div className="room-peek-head">
        <Icon name="visibility" size={16} />
        <span className="ellipsis">{summary?.name || summary?.alias || room}</span>
        <button type="button" className="button subtle" onClick={onClose}>
          Close
        </button>
      </div>

      {!summary && !failed && <div className="small muted">Looking…</div>}
      {failed && <div className="small muted">Couldn’t look: {failed}</div>}

      {summary && (
        <>
          <div className="small muted">
            {summary.members.toLocaleString()} members
            {summary.joinRule === 'knock'
              ? ' · asks to be knocked on'
              : summary.joinRule === 'restricted'
                ? ' · open to a space’s members'
                : summary.joinRule === 'invite'
                  ? ' · invitation only'
                  : ''}
            {summary.encrypted ? ' · encrypted' : ''}
          </div>
          {summary.topic && <div className="small room-peek-topic">{summary.topic}</div>}

          {/* Why there is no conversation below, in each of the two cases -
              the room's own rule, and the homeserver's. They are different
              answers and only one of them is about this room. */}
          {!summary.worldReadable && (
            <div className="small muted">
              This room’s history is only for people who have joined it, so there is nothing to
              read from out here.
            </div>
          )}
          {refused && <div className="small muted">{refused}</div>}

          {lines?.length === 0 && <div className="small muted">Nothing has been said here.</div>}
          {lines && lines.length > 0 && (
            <div className="room-peek-log">
              {lines.map((line) => (
                <div key={line.id} className="room-peek-line">
                  <span className="small muted tabular">{formatTime(line.ts)}</span>
                  <span className="room-peek-from">{line.isAction ? `* ${line.from}` : line.from}</span>
                  <span className="room-peek-body">{line.body}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
