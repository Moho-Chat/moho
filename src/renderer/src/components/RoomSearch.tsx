import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Avatar } from './Avatar'
import { Icon, IconButton } from './Icon'
import { useStore } from '../state/hooks'
import type { Account } from '../../../shared/wire'

interface PublicRoom {
  roomId: string
  name: string
  alias: string
  topic: string
  members: number
  avatarUrl?: string
  via: string
  joined: boolean
}

interface Answer {
  rooms: PublicRoom[]
  next: Record<string, string>
  servers: string[]
  refused: string[]
}

/** Long enough that a typed word is one search, short enough to feel live. */
const TYPING_SETTLE_MS = 450

/**
 * Finding a room, across every homeserver at once.
 *
 * A dialog over the window rather than a page inside the join panel, because
 * this is a thing you do *to* get somewhere rather than somewhere you are:
 * you open it, you type, you arrive, and it goes away. Element's spotlight is
 * the same shape and for the same reason.
 *
 * One list, not one list per server. A room directory belongs to a homeserver,
 * so the honest presentation would be a section each - but somebody searching
 * for a room by name does not know which server it is on, and that is exactly
 * the thing a per-server view asks them to know first. So the servers are
 * asked together, the answers are merged, and where a room lives is printed
 * beside it as a fact about the room rather than as a heading to navigate.
 */
export function RoomSearch({ account, onClose }: { account: Account; onClose: () => void }): JSX.Element {
  const store = useStore()
  const [query, setQuery] = useState('')
  const [extraServer, setExtraServer] = useState('')
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [busy, setBusy] = useState(false)
  const [joining, setJoining] = useState<Record<string, boolean>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  // Which search the answer in flight belongs to. A slow server answering a
  // query somebody has already typed past would otherwise replace the results
  // for what they are actually looking at now.
  const generation = useRef(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const servers = useMemo(
    () => (extraServer.trim() ? [extraServer.trim()] : []),
    [extraServer]
  )

  const search = (since?: Record<string, string>): void => {
    const mine = ++generation.current
    setBusy(true)
    void window.moho
      .rpc<Answer>('searchMatrixRooms', {
        accountId: account.id,
        query,
        servers,
        limit: 40,
        ...(since ? { since } : {})
      })
      .then((result) => {
        if (generation.current !== mine) return
        // A page adds to what is there; a fresh search replaces it. The
        // merged list is re-sorted either way, since a later page from one
        // server can be busier than an earlier page from another.
        setAnswer((current) =>
          since && current
            ? {
                ...result,
                rooms: [...current.rooms, ...result.rooms].sort((a, b) => b.members - a.members)
              }
            : result
        )
      })
      .catch((e: Error) => {
        if (generation.current === mine) store.toast('error', e.message)
      })
      .finally(() => {
        if (generation.current === mine) setBusy(false)
      })
  }

  // Searching as it is typed, once typing stops. Every keystroke would be a
  // request to a handful of other people's servers, which is both rude and
  // rate-limited.
  useEffect(() => {
    const t = setTimeout(() => search(), TYPING_SETTLE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, extraServer, account.id])

  const join = (room: PublicRoom): void => {
    setJoining((j) => ({ ...j, [room.roomId]: true }))
    void window.moho
      .rpc('joinMatrixRoom', {
        accountId: account.id,
        // An alias where there is one: it carries its own server and survives
        // the room being upgraded. A bare room id needs to be told where to
        // ask, which is the server that listed it.
        roomIdOrAlias: room.alias || room.roomId,
        via: room.alias ? [] : [room.via]
      })
      .then(() => onClose())
      .catch((e: Error) => {
        setJoining((j) => ({ ...j, [room.roomId]: false }))
        store.toast('error', e.message)
      })
  }

  const rooms = answer?.rooms ?? []
  const morePages = Object.keys(answer?.next ?? {}).length > 0

  return createPortal(
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="room-search"
        role="dialog"
        aria-modal="true"
        aria-label="Find a room"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="room-search-head">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            autoFocus
            className="room-search-input"
            placeholder="Search public rooms"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
          />
          <IconButton name="close" title="Close" onClick={onClose} />
        </div>

        <div className="room-search-servers small muted">
          <span>
            {/* The empty string is our own server, which has no name here -
                counted, not listed, so the line does not start with a gap. */}
            Searching {answer ? answer.servers.length : '…'} homeserver
            {answer && answer.servers.length === 1 ? '' : 's'}
            {answer?.refused.length ? ` — ${answer.refused.join(', ')} did not answer` : ''}
          </span>
          <input
            className="text-field room-search-server"
            placeholder="add a homeserver"
            value={extraServer}
            onChange={(e) => setExtraServer(e.target.value)}
          />
        </div>

        <div className="room-search-results">
          {rooms.map((room) => (
            <div key={room.roomId} className="room-search-row">
              <Avatar name={room.name || room.alias || room.roomId} url={room.avatarUrl} size={32} />
              <div className="room-search-text">
                <div className="room-search-title">
                  <span className="ellipsis">{room.name || room.alias || room.roomId}</span>
                  {room.alias && <span className="small muted ellipsis">{room.alias}</span>}
                </div>
                <div className="small muted room-search-detail ellipsis">
                  {room.members.toLocaleString()} members
                  {/* Where it lives, said once, beside the room rather than
                      over a section of them. */}
                  {room.via ? ` · ${room.via}` : ' · this server'}
                  {room.topic ? ` · ${room.topic}` : ''}
                </div>
              </div>
              <button
                type="button"
                className="button"
                disabled={room.joined || joining[room.roomId]}
                onClick={() => join(room)}
              >
                {room.joined ? 'Joined' : joining[room.roomId] ? 'Joining…' : 'Join'}
              </button>
            </div>
          ))}

          {!busy && rooms.length === 0 && (
            <p className="small muted room-search-empty">
              Nothing matched. A server only lists the rooms it has been asked to publish, so a room
              can exist and not be here — joining by address still works.
            </p>
          )}

          {busy && <p className="small muted room-search-empty">Searching…</p>}

          {morePages && rooms.length > 0 && (
            <button
              type="button"
              className="button room-search-more"
              disabled={busy}
              onClick={() => search(answer?.next)}
            >
              Show more
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
