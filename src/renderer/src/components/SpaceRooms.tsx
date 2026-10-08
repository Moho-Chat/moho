import { useEffect, useState } from 'react'
import { useEscapeLayer } from '../lib/layers'
import { Icon, IconButton } from './Icon'
import { useStore } from '../state/hooks'

interface SpaceRoom {
  roomId: string
  name: string
  alias: string
  topic: string
  members: number
  joined: boolean
  isSpace: boolean
  children: number
  joinRule: string
  via: string[]
}

/**
 * Everything a space holds, including what this account has not joined.
 *
 * Sync only ever says which of a space's rooms you are *in* - a room nobody
 * here has joined is in nobody's sync - so the rail entry showed the handful
 * already joined and offered no way to find the rest, which is most of what a
 * space is for. This asks the server instead, and its answer resolves through
 * federation: a space on one homeserver listing rooms on three others comes
 * back whole.
 *
 * Not the public directory in a different hat. A directory is searched; a
 * space is read. There is no query here because there is nothing to query -
 * the list is the space's own contents, in the order it keeps them.
 */
export function SpaceRooms({
  accountId,
  groupId,
  title,
  onClose
}: {
  accountId: string
  groupId: string
  title: string
  onClose: () => void
}): JSX.Element {
  const store = useStore()
  const [rooms, setRooms] = useState<SpaceRoom[]>([])
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [joining, setJoining] = useState<Record<string, boolean>>({})

  const load = (from: string): void => {
    setBusy(true)
    void window.moho
      .rpc<{ rooms: SpaceRoom[]; next: string }>('matrixSpaceHierarchy', { accountId, groupId, from })
      .then((answer) => {
        // Appended rather than replaced when paging, and the id is the guard:
        // a server that repeats a room across pages would otherwise show it
        // twice.
        setRooms((had) => {
          const seen = new Set(had.map((r) => r.roomId))
          return from ? [...had, ...answer.rooms.filter((r) => !seen.has(r.roomId))] : answer.rooms
        })
        setNext(answer.next)
        setError('')
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }

  useEffect(() => {
    load('')
  }, [groupId])
  useEscapeLayer(onClose)

  const join = (room: SpaceRoom): void => {
    setJoining((was) => ({ ...was, [room.roomId]: true }))
    void store
      .joinMatrixRoom(accountId, room.roomId, room.name || room.alias || room.roomId, room.via)
      // Marked joined here rather than waiting for the next sync: the room
      // takes a moment to arrive and a button that stays offering to join
      // something you just joined reads as the click having missed.
      .then(() => setRooms((had) => had.map((r) => (r.roomId === room.roomId ? { ...r, joined: true } : r))))
      .finally(() => setJoining((was) => ({ ...was, [room.roomId]: false })))
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal space-rooms" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="modal-title ellipsis">{title}</h2>
          <IconButton name="close" size={18} title="Close" onClick={onClose} />
        </div>

        {error && <p className="small error-text">{error}</p>}
        {!error && !busy && rooms.length === 0 && (
          <p className="small muted">This space lists no rooms.</p>
        )}

        <div className="space-room-list">
          {rooms.map((room) => (
            <div key={room.roomId} className="space-room">
              <span className="space-room-face">
                <Icon name={room.isSpace ? 'workspaces' : 'tag'} size={16} />
              </span>
              <span className="space-room-text">
                <span className="ellipsis">{room.name || room.alias || room.roomId}</span>
                {room.topic && <span className="small muted ellipsis">{room.topic}</span>}
                <span className="small muted space-room-meta">
                  {room.isSpace
                    ? `${room.children} ${room.children === 1 ? 'room' : 'rooms'}`
                    : `${room.members} ${room.members === 1 ? 'member' : 'members'}`}
                  {room.alias && ` · ${room.alias}`}
                  {/* Said outright, because it decides whether the button
                      below will work: a restricted room admits members of a
                      space, and a knock room has to be asked. */}
                  {room.joinRule === 'knock' && ' · ask to join'}
                  {room.joinRule === 'restricted' && ' · members of this space'}
                </span>
              </span>
              {room.joined ? (
                <span className="small muted space-room-in">In</span>
              ) : (
                <button
                  type="button"
                  className="small"
                  disabled={!!joining[room.roomId]}
                  onClick={() => join(room)}
                >
                  {joining[room.roomId] ? 'Joining…' : room.isSpace ? 'Add' : 'Join'}
                </button>
              )}
            </div>
          ))}
        </div>

        {next && (
          <button type="button" className="small" disabled={busy} onClick={() => load(next)}>
            {busy ? 'Loading…' : 'Show more'}
          </button>
        )}
        {busy && rooms.length === 0 && <p className="small muted">Reading the space…</p>}
      </div>
    </div>
  )
}
