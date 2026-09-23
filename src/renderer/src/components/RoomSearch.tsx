import { useEffect, useMemo, useRef, useState } from 'react'
import { ReasonPrompt } from './ReasonPrompt'
import { createPortal } from 'react-dom'
import { Avatar } from './Avatar'
import { RoomPeek } from './RoomPeek'
import { Icon, IconButton } from './Icon'
import { useStore } from '../state/hooks'
import { classes } from '../lib/util'
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
  /**
   * How this room is entered: "public" is joined, "knock" is asked, and
   * "restricted" is open to members of a space this account may not be in.
   * One button for all three is a button that fails for two of them.
   */
  joinRule?: string
}

/** One homeserver that was asked, and what came of asking it. */
interface SearchedServer {
  server: string
  /** How many rooms it contributed that no earlier server had already listed. */
  rooms: number
  /** Present instead of results when it would not answer, and why. */
  error?: string
}

interface Answer {
  rooms: PublicRoom[]
  next: Record<string, string>
  servers: SearchedServer[]
}

/** Long enough that a typed word is one search, short enough to feel live. */
const TYPING_SETTLE_MS = 450

/**
 * Two words for why a homeserver gave us nothing, with the full reason in the
 * tooltip.
 *
 * "No answer" was the label for all of them, and it is wrong for most: a
 * server that refuses to publish its directory has answered very clearly, and
 * treating that as silence sends somebody looking for a network fault that
 * does not exist.
 */
function refusalLabel(error: string): string {
  if (/M_FORBIDDEN|not allowed/i.test(error)) return 'refused'
  if (/M_LIMIT_EXCEEDED|too many requests/i.test(error)) return 'rate limited'
  if (/timed out|timeout/i.test(error)) return 'timed out'
  if (/M_UNRECOGNIZED|404/i.test(error)) return 'no directory'
  return 'no answer'
}

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
  /**
   * Servers switched off. Off rather than on, so a server that turns up later
   * - one added by hand, or one this account gained a room on - is included
   * without having to be found and enabled.
   */
  const [disabled, setDisabled] = useState<Set<string>>(new Set())
  /** The room being knocked on, while the reason is being written. */
  const [knocking, setKnocking] = useState<PublicRoom | null>(null)
  const [joining, setJoining] = useState<Record<string, boolean>>({})
  /** Which room somebody has asked to look into without joining it. */
  const [peeking, setPeeking] = useState<PublicRoom | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
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
        setAnswer((current) => {
          if (!since || !current) return result
          // By room id, keeping what is already on screen. A page from one
          // server can contain rooms another server listed on an earlier
          // page - the daemon can only deduplicate within a single answer,
          // since it does not know what this window is already showing - so
          // without this "show more" appended rooms that were already there.
          const seen = new Set(current.rooms.map((room) => room.roomId))
          const added = result.rooms.filter((room) => !seen.has(room.roomId))
          // A page only asks the servers that had somewhere to continue from,
          // so its answer names fewer servers than the search did. Merging
          // rather than replacing keeps the ones that finished on the first
          // page - they are still part of what is being shown, and a switch
          // that vanished when somebody pressed "show more" would be worse
          // than a stale count.
          const totals = new Map(current.servers.map((s) => [s.server, s]))
          for (const s of result.servers) {
            const before = totals.get(s.server)
            totals.set(s.server, before ? { ...s, rooms: before.rooms + s.rooms } : s)
          }
          return {
            ...result,
            servers: [...totals.values()].sort((a, b) => a.server.localeCompare(b.server)),
            rooms: [...current.rooms, ...added].sort((a, b) => b.members - a.members)
          }
        })
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

  /**
   * Asking to be let in, for a room that is asked rather than entered.
   *
   * The reason travels with the knock and is what the people inside read, so
   * it is worth writing - a knock with nothing attached is what most ignored
   * knocks look like.
   */
  const knock = (room: PublicRoom): void => {
    setKnocking(room)
  }

  const join = (room: PublicRoom): void => {
    if (room.joinRule === 'knock') return knock(room)
    setJoining((j) => ({ ...j, [room.roomId]: true }))
    void store
      // An alias where there is one: it carries its own server and survives
      // the room being upgraded. A bare room id needs to be told where to
      // ask, which is the server that listed it.
      .joinMatrixRoom(
        account.id,
        room.alias || room.roomId,
        room.name || room.alias || room.roomId,
        room.alias ? [] : [room.via]
      )
      .then(() => onClose())
      .catch((e: Error) => {
        setJoining((j) => ({ ...j, [room.roomId]: false }))
        // A restricted room refuses with a bare 403, which says nothing about
        // the one thing that would get you in.
        store.toast(
          'error',
          room.joinRule === 'restricted'
            ? `${room.name || room.roomId} is open to members of a space - join the space first, and this room opens with it`
            : e.message
        )
      })
  }

  /**
   * Asks for the next page as the end of this one comes into view.
   *
   * A screenful ahead rather than at the very bottom, so the next rooms are
   * usually there before somebody reaches where they would have been. Guarded
   * on `busy` because scrolling fires continuously and each of these is a
   * request to several homeservers.
   */
  const onScroll = (): void => {
    const el = resultsRef.current
    if (!el || busy || !answer || Object.keys(answer.next).length === 0) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - el.clientHeight) search(answer.next)
  }

  const rooms = (answer?.rooms ?? []).filter((room) => !disabled.has(room.via))
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
          <input
            className="text-field room-search-server"
            placeholder="add a homeserver"
            value={extraServer}
            onChange={(e) => setExtraServer(e.target.value)}
          />
          <IconButton name="close" title="Close" onClick={onClose} />
        </div>

        {/* Which servers, by name, on their own row so a dozen of them fit -
            and each one a switch, because "search everywhere" and "search
            these two" are both things somebody wants and the difference is
            the whole reason the list is merged.

            Turning one off filters what is already here rather than searching
            again: the results are in hand, and a round trip to hide rows
            somebody is looking at would make an instant thing slow. */}
        <div className="room-search-servers small muted">
          {!answer && <span className="muted">Asking every homeserver…</span>}
          {answer?.servers.map((s) => {
            const off = disabled.has(s.server)
            return (
              <button
                key={s.server}
                type="button"
                aria-pressed={!off}
                className={classes('server-chip', s.error && 'failed', off && 'off')}
                title={
                  s.error
                    ? `${s.server}: ${s.error}`
                    : `${s.server} — ${s.rooms} rooms. Click to ${off ? 'include' : 'hide'}.`
                }
                onClick={() =>
                  setDisabled((current) => {
                    const next = new Set(current)
                    if (!next.delete(s.server)) next.add(s.server)
                    return next
                  })
                }
              >
                {s.server}
                <span className="server-chip-count">
                  {s.error ? refusalLabel(s.error) : s.rooms}
                </span>
              </button>
            )
          })}
        </div>

        <div className="room-search-results" ref={resultsRef} onScroll={onScroll}>
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
                  {room.joinRule === 'knock'
                    ? ' · asks to be knocked on'
                    : room.joinRule === 'restricted'
                      ? ' · open to a space’s members'
                      : ''}
                  {room.topic ? ` · ${room.topic}` : ''}
                </div>
              </div>
              {/* Looking, offered beside joining rather than instead of it.
                  A join is a membership event everybody in the room sees,
                  and leaving again leaves both behind - so the two decisions
                  have to be separable, and on a room already joined there is
                  nothing to separate. */}
              {!room.joined && (
                <button
                  type="button"
                  className="button subtle"
                  title="See what is in it without joining"
                  onClick={() => setPeeking(peeking?.roomId === room.roomId ? null : room)}
                >
                  <Icon name="visibility" size={15} /> Look
                </button>
              )}
              <button
                type="button"
                className="button"
                disabled={room.joined || joining[room.roomId]}
                onClick={() => join(room)}
              >
                {room.joined
                  ? 'Joined'
                  : joining[room.roomId]
                    ? 'Joining…'
                    : room.joinRule === 'knock'
                      ? 'Knock'
                      : 'Join'}
              </button>
            </div>
          ))}

          {peeking && (
            <RoomPeek
              account={account}
              room={peeking.roomId}
              via={peeking.via}
              onClose={() => setPeeking(null)}
            />
          )}

          {knocking && (
            <ReasonPrompt
              title={`Ask to join ${knocking.name || knocking.alias || knocking.roomId}`}
              detail="This room is asked rather than entered. Whoever is inside sees your reason and decides; the answer comes back as an invitation."
              placeholder="Why you would like to join"
              confirmLabel="Knock"
              optional
              onCancel={() => setKnocking(null)}
              onConfirm={(reason) => {
                const room = knocking
                setKnocking(null)
                setJoining((j) => ({ ...j, [room.roomId]: true }))
                void store
                  .knockMatrixRoom(account.id, room.alias || room.roomId, room.alias ? [] : [room.via], reason)
                  .then(() => {
                    setJoining((j) => ({ ...j, [room.roomId]: false }))
                    store.toast('info', `Asked to join ${room.name || room.roomId}. The answer arrives as an invitation.`)
                  })
                  .catch((e: Error) => {
                    setJoining((j) => ({ ...j, [room.roomId]: false }))
                    store.toast('error', e.message)
                  })
              }}
            />
          )}

          {!busy && rooms.length === 0 && (answer?.rooms.length ?? 0) > 0 && (
            <p className="small muted room-search-empty">
              Every server with results is switched off above.
            </p>
          )}

          {!busy && (answer?.rooms.length ?? 0) === 0 && (
            <p className="small muted room-search-empty">
              Nothing matched. A server only lists the rooms it has been asked to publish, so a room
              can exist and not be here — joining by address still works.
            </p>
          )}

          {busy && <p className="small muted room-search-empty">Searching…</p>}

          {/* Scrolling asks for the next page; this only says so. A button
              at the end of a list is a second decision to make about the
              thing somebody is already doing, which is looking further down
              the list. */}
          {morePages && rooms.length > 0 && busy && (
            <p className="small muted room-search-empty">
              <span className="spinner" /> Loading more…
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
