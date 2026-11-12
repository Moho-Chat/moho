import { useState } from 'react'
import { useStore } from '../state/hooks'
import type { Account } from '../../../shared/wire'

/**
 * Adding a person, and finding or entering a room, on an XMPP account. A room is found only where the account's own server
 * says it has them (the conference services it hosts) or by an address somebody gives: there is no directory of the whole
 * network to search, and none is invented.
 */
export function XmppJoin({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const connected = account.state === 'connected'
  const [contact, setContact] = useState('')
  const [name, setName] = useState('')
  const [room, setRoom] = useState('')
  const [nick, setNick] = useState('')
  const [password, setPassword] = useState('')
  const [rooms, setRooms] = useState<{ jid: string; name: string }[] | null>(null)
  const [looking, setLooking] = useState(false)
  const fail = (e: Error): void => store.toast('error', e.message)

  const addContact = (): void => {
    void window.moho
      .rpc('xmppAddContact', { accountId: account.id, jid: contact.trim(), name: name.trim() })
      .then(() => {
        store.toast('info', `Asked ${contact.trim()} to share presence`)
        setContact('')
        setName('')
      })
      .catch(fail)
  }
  const join = (jid: string, withNick = '', withPassword = ''): void => {
    void window.moho
      .rpc<{ bufferId?: string }>('xmppJoinRoom', { accountId: account.id, jid, nick: withNick, password: withPassword })
      .then(async (r) => {
        await store.refreshBuffers()
        if (r.bufferId) void store.selectBuffer(r.bufferId)
        setRoom('')
      })
      .catch(fail)
  }
  const look = (): void => {
    setLooking(true)
    void window.moho
      .rpc<{ rooms: { jid: string; name: string }[] }>('xmppListRooms', { accountId: account.id })
      .then((r) => setRooms(r.rooms))
      .catch(fail)
      .finally(() => setLooking(false))
  }

  return (
    <div className="panel join-panel">
      <span className="small muted">Add a contact</span>
      <div className="field-row">
        <input className="text-field" placeholder="friend@example.org" spellCheck={false} value={contact} disabled={!connected} onChange={(e) => setContact(e.target.value)} />
        <input className="text-field" placeholder="Name (optional)" value={name} disabled={!connected} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="button" disabled={!connected || !/^[^@\s]+@[^@\s]+$/.test(contact.trim())} onClick={addContact}>
          Add
        </button>
      </div>
      <span className="small muted">Join a room, or make one by joining an address that is not taken</span>
      <div className="field-row">
        <input className="text-field" placeholder="room@conference.example.org" spellCheck={false} value={room} disabled={!connected} onChange={(e) => setRoom(e.target.value)} />
        <input className="text-field" placeholder="Nickname" value={nick} disabled={!connected} onChange={(e) => setNick(e.target.value)} />
        <input className="text-field" type="password" placeholder="Password (if it has one)" value={password} disabled={!connected} onChange={(e) => setPassword(e.target.value)} />
        <button type="button" className="button" disabled={!connected || !/^[^@\s]+@[^@\s]+$/.test(room.trim())} onClick={() => join(room.trim(), nick.trim(), password)}>
          Join
        </button>
      </div>
      <span className="small muted">Rooms on your own server</span>
      <div className="field-row">
        <button type="button" className="button" disabled={!connected || looking} onClick={look}>
          {looking ? 'Looking…' : 'Look'}
        </button>
      </div>
      {rooms && rooms.length === 0 && <p className="small muted">Your server lists no public rooms.</p>}
      {rooms && rooms.length > 0 && (
        <ul className="plain-list">
          {rooms.map((r) => (
            <li key={r.jid} className="field-row">
              <span className="ellipsis">{r.name || r.jid}</span>
              <span className="small muted ellipsis">{r.jid}</span>
              <button type="button" className="button small" onClick={() => join(r.jid)}>
                Join
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
