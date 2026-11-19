import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { Avatar } from './Avatar'
import { useStore } from '../state/hooks'
import { bufferDisplayName } from '../lib/util'

interface SideRoom {
  bufferId: string
  name: string
  group: boolean
}

interface Person {
  id: string
  name: string
}

/**
 * Inviting somebody to a Kiwi Farms side room - the chat's private rooms,
 * which took the place of whispers.
 *
 * Opened two ways. From somebody's name (a message, the member list): who is
 * known, and the choice is where to - a new side room, or one this account is
 * already in. From a side room's own menu: where is known, and the choice is
 * who, found by name among everybody the chat has shown this account (it has
 * no directory of its own to search).
 */
export function SneedchatInvite({
  accountId,
  person,
  roomBufferId,
  onClose
}: {
  accountId: string
  /** Who, when opened from a name: their principal id (or name) and name. */
  person?: Person
  /** Where, when opened from a side room. */
  roomBufferId?: string
  onClose: () => void
}): JSX.Element {
  const store = useStore()
  const [rooms, setRooms] = useState<SideRoom[]>([])
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState<Person[]>([])
  const [busy, setBusy] = useState('')
  const box = useRef<HTMLInputElement>(null)

  useEffect(() => {
    box.current?.focus()
    if (person) {
      void window.moho
        .rpc<SideRoom[]>('sneedchatSideRooms', { accountId })
        .then(setRooms)
        .catch(() => setRooms([]))
    }
  }, [accountId, person])

  // People as the name is typed, a moment after the typing stops.
  useEffect(() => {
    if (person) return
    const q = query.trim()
    if (!q) {
      setPeople([])
      return
    }
    const timer = setTimeout(() => {
      void window.moho
        .rpc<Person[]>('searchSneedchatPeople', { accountId, query: q })
        .then(setPeople)
        .catch(() => setPeople([]))
    }, 200)
    return () => clearTimeout(timer)
  }, [accountId, person, query])

  const invite = (who: Person, toBufferId?: string): void => {
    setBusy(toBufferId ?? who.id ?? 'new')
    void window.moho
      .rpc<{ bufferId: string }>('sneedchatInvite', { accountId, who: who.id || who.name, bufferId: toBufferId })
      .then((r) => {
        store.toast('info', toBufferId ? `Invited ${who.name}` : `Opened a side room with ${who.name}`)
        onClose()
        if (r?.bufferId) void store.selectBuffer(r.bufferId)
      })
      .catch((e: Error) => {
        setBusy('')
        store.toast('error', e.message)
      })
  }

  if (person) {
    const q = query.trim().toLowerCase()
    const shown = rooms.filter((r) => !q || r.name.toLowerCase().includes(q))
    return (
      <Modal title={`Invite ${person.name} to a side room`} icon="group_add" className="forward-picker" onClose={onClose}>
        <input ref={box} className="text-field" placeholder="Which side room…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="forward-picker-list">
          <button type="button" className="forward-choice" disabled={!!busy} onClick={() => invite(person)}>
            <Avatar name="+" size={22} />
            <span className="ellipsis">New side room with {person.name}</span>
            {busy === person.id && <span className="spinner" aria-label="Inviting" />}
          </button>
          {shown.map((room) => (
            <button key={room.bufferId} type="button" className="forward-choice" disabled={!!busy} onClick={() => invite(person, room.bufferId)}>
              <Avatar name={room.name} size={22} accountId={accountId} />
              <span className="ellipsis">{bufferDisplayName(room.name)}</span>
              <span className="small muted ellipsis">{room.group ? 'group' : 'side room'}</span>
              {busy === room.bufferId && <span className="spinner" aria-label="Inviting" />}
            </button>
          ))}
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Invite someone" icon="group_add" className="forward-picker" onClose={onClose}>
      <input ref={box} className="text-field" placeholder="Their name…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="forward-picker-list">
        {people.map((p) => (
          <button key={p.id} type="button" className="forward-choice" disabled={!!busy} onClick={() => invite(p, roomBufferId)}>
            <Avatar name={p.name} size={22} accountId={accountId} />
            <span className="ellipsis">{p.name}</span>
            {busy === roomBufferId && <span className="spinner" aria-label="Inviting" />}
          </button>
        ))}
        {query.trim() && people.length === 0 && (
          <p className="small muted emoji-empty">Nobody by that name has been seen in this chat yet - only people who have been in your rooms or written in them can be found.</p>
        )}
      </div>
    </Modal>
  )
}
