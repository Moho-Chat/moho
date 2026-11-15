import { useState } from 'react'
import { useStore } from '../state/hooks'
import { Initial, JoinAction, JoinRow, JoinSection } from './JoinParts'
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

  const address = (v: string): boolean => /^[^@\s]+@[^@\s]+$/.test(v.trim())

  return (
    <>
      <JoinSection kind="people">
        <JoinAction icon="person_add" title="Add a contact" help="Asks them to share presence with you; they answer from their own client.">
          <div className="action-field">
            <input className="text-field" placeholder="friend@example.org" spellCheck={false} value={contact} disabled={!connected} onChange={(e) => setContact(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && address(contact) && addContact()} />
            <input className="text-field action-field-minor" placeholder="Name (optional)" value={name} disabled={!connected} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && address(contact) && addContact()} />
            <button type="button" className="button primary" disabled={!connected || !address(contact)} onClick={addContact}>
              Add contact
            </button>
          </div>
        </JoinAction>
      </JoinSection>

      <JoinSection kind="join">
        <JoinAction icon="tag" title="Join a room" help="By its address. Joining an address that is not taken makes the room.">
          <input className="text-field" placeholder="room@conference.example.org" spellCheck={false} value={room} disabled={!connected} onChange={(e) => setRoom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && address(room) && join(room.trim(), nick.trim(), password)} />
          <div className="action-field">
            <input className="text-field" placeholder="Nickname" value={nick} disabled={!connected} onChange={(e) => setNick(e.target.value)} />
            <input className="text-field" type="password" placeholder="Password (if it has one)" value={password} disabled={!connected} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="button primary" disabled={!connected || !address(room)} onClick={() => join(room.trim(), nick.trim(), password)}>
              Join
            </button>
          </div>
        </JoinAction>
      </JoinSection>

      <JoinSection kind="browse">
        <JoinAction
          icon="travel_explore"
          title="Rooms on your own server"
          help={
            rooms && rooms.length === 0
              ? 'Your server lists no public rooms.'
              : 'XMPP has no directory of the whole network: this is what the server your account is on says it hosts.'
          }
          aside={
            <button type="button" className={rooms ? 'button quiet' : 'button primary'} disabled={!connected || looking} onClick={look}>
              {looking ? 'Looking…' : rooms ? 'Look again' : 'Look'}
            </button>
          }
        />
        {rooms?.map((r) => (
          <JoinRow key={r.jid} face={<Initial name={r.name || r.jid} />} name={r.name || r.jid} sub={r.jid}>
            <button type="button" className="button quiet small" onClick={() => join(r.jid)}>
              Join
            </button>
          </JoinRow>
        ))}
      </JoinSection>
    </>
  )
}
