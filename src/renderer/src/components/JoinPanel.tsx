import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { ContextMenu } from './ContextMenu'
import { RoomSearch } from './RoomSearch'
import { KNOWN_SNEEDCHAT_ROOMS } from '../lib/sneedchat'
import { useChat, useStore } from '../state/hooks'
import { classes, resolveMediaUrl } from '../lib/util'
import { CaptchaCancelled, rpcAnsweringCaptcha } from '../lib/captcha'
import type { Account, DiscordFriend, SneedChatRoom } from '../../../shared/wire'

/**
 * How many other people a Discord group message holds - ten including you.
 * Mirrored from the daemon so the picker can stop at the limit rather than
 * letting somebody choose eleven names and then be told no.
 */
const GROUP_DM_MAX = 9

/**
 * The code out of an invite, however it was written down.
 *
 * People paste the whole link, the short one, or just the code off the end of
 * a message, and all three mean the same server. Anything unrecognisable is
 * treated as a bare code, which is what it usually is - and if it is not,
 * Discord says so in a refusal clearer than anything this could produce.
 *
 * The daemon takes the last path segment too, but not a query string: a link
 * copied out of an event announcement carries `?event=…`, and the code has to
 * survive that.
 */
function inviteCode(entered: string): string {
  const text = entered.trim()
  const code = text
    .replace(/^https?:\/\//i, '')
    .replace(/^(www\.)?(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\//i, '')
    .split(/[?#/]/)[0]
  return code || text
}

/** A room this account has been invited to and not yet answered. */
type MatrixInvite = {
  roomId: string
  name: string
  inviter: string | null
  avatarUrl: string | null
  isDirect: boolean
}

/**
 * Per-protocol join pages rather than one generic "join by name" field: each
 * service's mechanism is genuinely different (IRC joins by channel name,
 * Discord accepts an invite, Matrix takes a room id or alias, Kick names a
 * streamer, Sneedchat's rooms are a fixed set edited in Settings), and
 * flattening them into one box would just mean a field that silently means
 * five things.
 *
 * The page always targets the single account whose "+" was clicked, so there
 * is no account picker here.
 */
export function JoinPanel(): JSX.Element {
  const accountId = useChat((s) => s.joinPanelAccountId)
  const account = useChat((s) => s.accounts).find((a) => a.id === accountId)

  if (!account) return <div className="panel muted">No account selected.</div>

  switch (account.service) {
    case 'irc':
      return <IrcJoin account={account} />
    case 'matrix':
      return <MatrixJoin account={account} />
    case 'discord':
      return <DiscordJoin account={account} />
    case 'kick':
      return <KickJoin account={account} />
    case 'sneedchat':
      return <SneedchatRooms account={account} />
    default:
      return <div className="panel muted">Joining isn&apos;t supported for this service yet.</div>
  }
}

/** A labelled field that fires on Enter and clears itself. */
function SubmitField({
  label,
  placeholder,
  onSubmit
}: {
  label: string
  placeholder: string
  onSubmit: (value: string) => void
}): JSX.Element {
  const [value, setValue] = useState('')
  const submit = (): void => {
    if (!value.trim()) return
    onSubmit(value.trim())
    setValue('')
  }
  return (
    <div className="field">
      <span className="small muted">{label}</span>
      <div className="field-row">
        <input
          className="text-field"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button type="button" className="button" onClick={submit} disabled={!value.trim()}>
          Go
        </button>
      </div>
    </div>
  )
}

function IrcJoin({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const call = (method: string, params: Record<string, unknown>): void => {
    void window.moho.rpc(method, params).catch((e: Error) => store.toast('error', e.message))
  }
  return (
    <div className="panel join-panel">
      <SubmitField
        label="Join a channel"
        placeholder="#channel"
        onSubmit={(name) => call('joinBuffer', { accountId: account.id, name })}
      />
      <SubmitField
        label="Message someone"
        placeholder="nick"
        // IRC has no "open a DM" call - a query buffer only exists once
        // something is sent, so this joins a buffer named for the nick.
        onSubmit={(nick) => call('joinBuffer', { accountId: account.id, name: nick })}
      />
      <IrcChannelBrowser account={account} />
    </div>
  )
}

/**
 * The network's own channel list.
 *
 * Asked for rather than shown, and that is the whole design: a LIST on a real
 * network answers with tens of thousands of channels and some servers throttle
 * or refuse it outright, so it is a button somebody presses rather than
 * something that happens on opening this page.
 *
 * Filtered here rather than in the request. The daemon holds the whole answer
 * and typing narrows it instantly, where a server-side filter would mean a new
 * LIST per keystroke against something that just rate-limited you.
 */
function IrcChannelBrowser({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  // The server buffer is where a command with no conversation of its own is
  // typed. Found rather than assembled from the account id: the daemon names
  // it after the host it actually connected to, which is not always the host
  // that was typed into the account form.
  const serverBuffer = useChat((s) => s.buffers).find(
    (b) => b.accountId === account.id && b.kind === 'server'
  )
  const [channels, setChannels] = useState<IrcChannelListing[] | null>(null)
  const [asking, setAsking] = useState(false)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    return window.moho.onEvent((frame) => {
      if (frame.event !== 'ircChannelList') return
      const data = frame.data as { accountId: string; channels: IrcChannelListing[] }
      if (data.accountId !== account.id) return
      setAsking(false)
      setChannels(data.channels)
    })
  }, [account.id])

  const ask = (): void => {
    if (!serverBuffer) {
      store.toast('error', 'Not connected to this network yet')
      return
    }
    setAsking(true)
    setChannels(null)
    void window.moho.rpc('sendMessage', { bufferId: serverBuffer.id, body: '/list' }).catch((e: Error) => {
      setAsking(false)
      store.toast('error', e.message)
    })
  }

  const shown = channels
    ? channels.filter((c) => {
        const q = filter.trim().toLowerCase()
        if (!q) return true
        return c.name.toLowerCase().includes(q) || c.topic.toLowerCase().includes(q)
      })
    : []

  return (
    <div className="field">
      <span className="small muted">Browse the network&apos;s channels</span>
      <div className="field-row">
        <input
          className="text-field"
          placeholder={channels ? 'filter by name or topic' : 'ask the server for its list first'}
          value={filter}
          disabled={!channels}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button type="button" className="button" disabled={asking || !serverBuffer} onClick={ask}>
          {asking ? 'Asking…' : channels ? 'Refresh' : 'List channels'}
        </button>
      </div>

      {asking && (
        <p className="small muted">
          A busy network can take a minute to answer, and some refuse the request entirely.
        </p>
      )}

      {channels && (
        <>
          <p className="small muted">
            {channels.length.toLocaleString()} channels, busiest first
            {shown.length !== channels.length ? ` — ${shown.length.toLocaleString()} matching` : ''}
          </p>
          <div className="channel-browser">
            {/* Capped, because a filter that matches nothing in particular
                still matches forty thousand rows, and drawing them would
                freeze the window to no purpose. */}
            {shown.slice(0, 200).map((c) => (
              <button
                key={c.name}
                type="button"
                className="channel-browser-row"
                title={c.topic || c.name}
                onClick={() => join(account.id, c.name, store)}
              >
                <span className="ellipsis channel-browser-name">{c.name}</span>
                <span className="small muted channel-browser-users">{c.users.toLocaleString()}</span>
                <span className="small muted ellipsis channel-browser-topic">{c.topic}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

interface IrcChannelListing {
  name: string
  users: number
  topic: string
}

function join(accountId: string, name: string, store: ReturnType<typeof useStore>): void {
  void window.moho.rpc('joinBuffer', { accountId, name }).catch((e: Error) => store.toast('error', e.message))
}

/**
 * Kick has nothing to join: a channel is a streamer, and naming one is all
 * there is to it. So this is the shortest page here - a handle, and it starts
 * following that chat.
 *
 * The field takes a handle in any form somebody is likely to have it, because
 * a channel is something you arrive at from a link far more often than from
 * memory: a pasted kick.com URL, an @handle, or the bare name all name the
 * same streamer, and the daemon takes the handle out of whatever arrives.
 */
function KickJoin({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  return (
    <div className="panel join-panel">
      <SubmitField
        label="Watch a streamer's chat"
        placeholder="handle, or a kick.com link"
        onSubmit={(name) =>
          void window.moho
            .rpc('joinBuffer', { accountId: account.id, name })
            .catch((e: Error) => store.toast('error', e.message))
        }
      />
      <p className="small muted">
        Kick chat is public, so this works signed out. Signing in adds talking, and your
        subscriber emotes for the channels you subscribe to.
      </p>
    </div>
  )
}

/**
 * Making a room, or a space.
 *
 * One form for both, because a space is a room with a different creation type
 * and nothing else - offering two would be inventing a distinction the
 * protocol does not have.
 *
 * Encryption is offered and defaults to off, which is the choice that can
 * still be changed: a room can be encrypted later and never un-encrypted, so
 * the reversible default is the honest one.
 */
function CreateMatrixRoom({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [isSpace, setIsSpace] = useState(false)
  const [isPublic, setIsPublic] = useState(false)
  const [encrypted, setEncrypted] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!open) {
    return (
      <div className="field">
        <button type="button" className="button" onClick={() => setOpen(true)}>
          Create a room or space
        </button>
      </div>
    )
  }

  const create = (): void => {
    if (!name.trim()) return
    setBusy(true)
    void window.moho
      .rpc('createMatrixRoom', { accountId: account.id, name, topic, isSpace, isPublic, encrypted })
      .then(() => {
        // Not selected here: the room arrives through the next sync with the
        // name and kind the server settled on, and jumping at a buffer that
        // does not exist yet would land on nothing.
        store.toast('info', `Created ${name}. It will appear once the server confirms it.`)
        setName('')
        setTopic('')
        setOpen(false)
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="field">
      <span className="small muted">{isSpace ? 'New space' : 'New room'}</span>
      <input
        className="text-field"
        autoFocus
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && create()}
      />
      <input
        className="text-field"
        placeholder="Topic (optional)"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && create()}
      />
      <label className="checkbox-row">
        <input type="checkbox" checked={isSpace} onChange={(e) => setIsSpace(e.target.checked)} />
        <span>
          Make it a space
          <span className="small muted"> — a container for other rooms rather than a place to talk</span>
        </span>
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
        <span>
          Anyone can find and join it
          <span className="small muted"> — otherwise it is invite only</span>
        </span>
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={encrypted}
          disabled={isPublic}
          onChange={(e) => setEncrypted(e.target.checked)}
        />
        <span>
          Encrypt it
          <span className="small muted">
            {' '}
            — cannot be turned off later, so a room that might need it should have it from the start
          </span>
        </span>
      </label>
      <div className="field-row">
        <button type="button" className="button primary" disabled={busy || !name.trim()} onClick={create}>
          {busy ? 'Creating…' : 'Create'}
        </button>
        <button type="button" className="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * Rooms somebody has asked this account to join.
 *
 * Shown above the join field because it is the one thing here that arrived
 * on its own: everything else on this page is a room you already know the
 * name of and went looking for. An invite was invisible until recently -
 * the daemon never read them out of sync - so it is worth being plain about
 * who sent it, since a room with no name of its own shows as its raw id and
 * the inviter is the only part that makes it answerable.
 */
function MatrixInvites({ account }: { account: Account }): JSX.Element | null {
  const store = useStore()
  const [invites, setInvites] = useState<MatrixInvite[]>([])
  const [answering, setAnswering] = useState<string | null>(null)

  useEffect(() => {
    const load = (): void => {
      void window.moho
        .rpc<MatrixInvite[]>('listMatrixInvites', { accountId: account.id })
        // An older daemon has no such method, and no invites to show.
        .then(setInvites)
        .catch(() => setInvites([]))
    }
    load()
    // The daemon pushes the whole set whenever it changes, so accepting from
    // another client empties this without anybody refreshing.
    return window.moho.onEvent((frame) => {
      if (frame.event !== 'matrixInvites') return
      const data = frame.data as { accountId: string; invites: MatrixInvite[] }
      if (data.accountId === account.id) setInvites(data.invites ?? [])
    })
  }, [account.id])

  if (invites.length === 0) return null

  const answer = (invite: MatrixInvite, accept: boolean): void => {
    setAnswering(invite.roomId)
    void window.moho
      .rpc(accept ? 'acceptMatrixInvite' : 'declineMatrixInvite', {
        accountId: account.id,
        roomId: invite.roomId
      })
      // Not removed from the list here: the next sync stops listing it,
      // which is what actually confirms the server agreed.
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setAnswering(null))
  }

  return (
    <div className="field">
      <span className="small muted">
        {invites.length === 1 ? 'You have been invited to' : `You have ${invites.length} invitations`}
      </span>
      <div className="invite-list">
        {invites.map((invite) => (
          <div className="invite-row" key={invite.roomId}>
            <div className="invite-what">
              <span className="invite-name ellipsis">{invite.name}</span>
              {invite.inviter && (
                <span className="small muted ellipsis">
                  from {invite.inviter}
                  {invite.isDirect ? ' · direct message' : ''}
                </span>
              )}
            </div>
            <div className="invite-actions">
              <button
                type="button"
                className="button primary"
                disabled={answering === invite.roomId}
                onClick={() => answer(invite, true)}
              >
                Accept
              </button>
              <button
                type="button"
                className="button"
                disabled={answering === invite.roomId}
                onClick={() => answer(invite, false)}
              >
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MatrixJoin({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  return (
    <div className="panel join-panel">
      <MatrixInvites account={account} />
      <SubmitField
        label="Join a room or space"
        // A Space is just a room with an m.space creation type, joined through
        // this same endpoint - no separate mechanism needed.
        placeholder="#room:server or !roomid:server"
        onSubmit={(roomIdOrAlias) =>
          // Named by what was typed until the room says otherwise: an address
          // is what somebody has in hand here, and a row called by it is
          // better than no row while the join happens.
          void store
            .joinMatrixRoom(account.id, roomIdOrAlias, roomIdOrAlias)
            .catch((e: Error) => store.toast('error', e.message))
        }
      />
      <SubmitField
        label="Start a DM"
        placeholder="@user:server"
        onSubmit={(userId) =>
          void window.moho
            .rpc<{ bufferId: string }>('openMatrixDm', { accountId: account.id, userId, displayName: '' })
            .then((r) => store.selectBuffer(r.bufferId))
            .catch((e: Error) => store.toast('error', e.message))
        }
      />
      <FindRoomButton account={account} />
      <CreateMatrixRoom account={account} />
    </div>
  )
}

/**
 * The way into the room search, which is a dialog rather than a section here.
 *
 * A search that spans every homeserver returns a great many rooms, and a list
 * that long inside a page of small fields would push everything else off the
 * bottom. It also is not really part of joining by address - it is how you
 * find the address in the first place.
 */
function FindRoomButton({ account }: { account: Account }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="field">
      <span className="small muted">Find a public room</span>
      <button type="button" className="button" onClick={() => setOpen(true)}>
        <Icon name="search" size={15} /> Search every homeserver
      </button>
      {open && <RoomSearch account={account} onClose={() => setOpen(false)} />}
    </div>
  )
}

/**
 * Which Sneedchat rooms this account stays connected to.
 *
 * Here rather than in the account's own settings, now that the list comes
 * from the site: this is the page for "join something", and a room being
 * ticked is exactly that. The account pane is for what an account *is* -
 * its name, its picture, how it signs in - and a catalogue of rooms was
 * never that.
 *
 * Each room keeps its own permanent connection, but they share the one
 * embedded Tor circuit, so joining another costs very little.
 */
function SneedchatRooms({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const [localRooms, setLocalRooms] = useState<SneedChatRoom[] | null>(null)
  const enabled = localRooms ?? account.sneedchatRooms ?? []

  useEffect(() => {
    setLocalRooms(null)
  }, [account.sneedchatRooms])

  /**
   * The catalogue, from the site.
   *
   * The daemon reads the room switcher off the chat page - the same list a
   * person sees down the side of the site - and answers with whatever it read
   * last, then sends the fresh one as an event a few seconds later. The
   * built-in list is the fallback rather than the source: the site is behind
   * a proof-of-work gate over Tor and the read can fail, and rooms somebody
   * can still tick beat an empty page.
   */
  const [rooms, setRooms] = useState(KNOWN_SNEEDCHAT_ROOMS)
  const [asking, setAsking] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setAsking(true)
    void window.moho
      .rpc<{ rooms: { id: number; name: string }[] }>('listSneedChatRooms', { accountId: account.id })
      .then((r) => live && r.rooms?.length && setRooms(r.rooms))
      .catch((e: Error) => live && setError(e.message))

    const stop = window.moho.onEvent((frame) => {
      if (frame.event !== 'sneedchatRooms') return
      const data = frame.data as { accountId: string; rooms: { id: number; name: string }[] }
      if (!live || data.accountId !== account.id || !data.rooms.length) return
      setRooms(data.rooms)
      setAsking(false)
      setError('')
    })
    return () => {
      live = false
      stop()
    }
  }, [account.id])

  /** The #general room entry, used as the minimum when the last room is unchecked. */
  const GENERAL: SneedChatRoom = { id: 1, name: 'general' }

  const toggle = (id: number, on: boolean): void => {
    const target = rooms.find((r) => r.id === id)
    if (on && !target) return
    let next = on
      ? enabled.some((r) => r.id === id)
        ? enabled
        : [...enabled, target!]
      : enabled.filter((r) => r.id !== id)
    // An account with no rooms falls back to #general on the daemon side;
    // reflect that here so the checkbox stays ticked rather than showing an
    // empty list that silently means #general.
    if (next.length === 0) next = [GENERAL]
    setLocalRooms(next)
    void window.moho
      .rpc('setSneedChatRooms', { accountId: account.id, rooms: next })
      .then(() => store.refreshAccounts())
      .catch((e: Error) => {
        setLocalRooms(null)
        store.toast('error', e.message)
      })
  }

  return (
    <div className="panel join-panel">
      <div className="field">
        <span className="small muted">
          Rooms{asking ? ' — asking the site…' : ''}
        </span>
        {rooms.map((room) => (
          <label key={room.id} className="checkbox-row">
            <input
              type="checkbox"
              checked={enabled.some((r) => r.id === room.id)}
              disabled={room.id === 1 && enabled.length === 1 && enabled[0].id === 1}
              onChange={(e) => toggle(room.id, e.target.checked)}
            />
            <span>#{room.name}</span>
          </label>
        ))}
        {/* Said rather than hidden: this list is the one this client shipped
            with, and the site may well have rooms that are not in it. */}
        {error && (
          <span className="small muted">
            Could not read the site&apos;s room list ({error}) — showing the rooms this client
            knows.
          </span>
        )}
        {/* An account with none ticked still connects to #general - the daemon
            falls back to it so a freshly added account is usable before
            anybody has been here. Worth saying, or an empty list reads as
            "connected to nothing". */}
        {enabled.length === 0 && (
          <span className="small muted">None chosen &mdash; this account uses #general.</span>
        )}
      </div>
    </div>
  )
}

/**
 * This backend runs on a user token, not a bot, so joining a server means
 * accepting an invite exactly as a human would. There's no guild-wide member
 * search available to a user-token client, hence DM-by-numeric-id alongside
 * the friends list rather than a search box.
 */
function DiscordJoin({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const [friends, setFriends] = useState<DiscordFriend[]>([])
  const [onlineOnly, setOnlineOnly] = useState(true)
  /**
   * Who is going into a new group message, or null when not making one.
   *
   * A mode rather than a always-on multi-select, because the ordinary thing
   * to do with a friend is open the conversation you already have with them,
   * and a list that needed a second click to do that would be worse at the
   * common case to be better at the rare one.
   */
  const [picking, setPicking] = useState<string[] | null>(null)
  /**
   * The friend a right-click landed on, and where.
   *
   * One piece of state for the whole list rather than a menu per row: a row
   * is drawn for every friend, and `useContextMenu` is a hook that cannot be
   * called inside the map that draws them.
   */
  const [friendMenu, setFriendMenu] = useState<{ x: number; y: number; friend: DiscordFriend } | null>(null)

  const refreshFriends = (): void => {
    void window.moho
      .rpc<DiscordFriend[]>('listDiscordFriends', { accountId: account.id })
      .then(setFriends)
      .catch(() => setFriends([]))
  }

  useEffect(refreshFriends, [account.id])

  // And whatever has changed since this was asked. A request that arrives
  // while this panel is open is exactly the one somebody is waiting for, so
  // it appears rather than waiting for the refresh button.
  const live = useChat((s) => s.discordFriends)[account.id]
  useEffect(() => {
    if (live) setFriends(live)
  }, [live])

  // Requests are their own list above the friends. They are not people you
  // can message and they are the thing somebody opened this panel to deal
  // with, so filtering them by whether they happen to be online - which is
  // what the toggle below does - would hide the ones that matter most.
  const waiting = friends.filter((f) => f.kind === 'incoming' || f.kind === 'outgoing')
  const settled = friends.filter((f) => !f.kind || f.kind === 'friend')
  const shown = onlineOnly ? settled.filter((f) => f.status && f.status !== 'offline') : settled

  /**
   * Does one of the three things above, showing Discord's captcha if it wants
   * one - `rpcAnsweringCaptcha` makes the detour invisible from here.
   *
   * Silent on a cancelled captcha: somebody closing the challenge has already
   * said what they meant, and a toast telling them they cancelled is noise.
   */
  const act = (
    done: string,
    method: string,
    params: Record<string, unknown>,
    after?: () => void
  ): void => {
    void rpcAnsweringCaptcha(method, params)
      .then(() => {
        store.toast('info', done)
        after?.()
      })
      .catch((e: Error) => {
        if (e instanceof CaptchaCancelled) return
        store.toast('error', e.message)
      })
  }

  const answer = (userId: string, accept: boolean): void => {
    void window.moho
      .rpc('answerDiscordFriendRequest', { accountId: account.id, userId, accept })
      .then(refreshFriends)
      .catch((e: Error) => store.toast('error', e.message))
  }

  /**
   * Unfriending somebody. The same call as declining a request, because
   * Discord models it as the same thing: a relationship, removed. Which of
   * the three states you were in is what decides what it meant.
   *
   * No countdown in front of it, unlike leaving a server. That one needs an
   * invite to undo and there may be nobody left to ask; this one is undone by
   * asking again, so the cost of a misclick is a sentence to somebody you
   * know rather than a door that has shut.
   */
  const removeFriend = (f: DiscordFriend): void => {
    setFriendMenu(null)
    void window.moho
      .rpc('answerDiscordFriendRequest', { accountId: account.id, userId: f.userId, accept: false })
      .then(() => {
        store.toast('info', `Removed ${f.globalName || f.username}`)
        refreshFriends()
      })
      .catch((e: Error) => store.toast('error', e.message))
  }

  return (
    <div className="panel join-panel">
      {/* These used to be links to discord.com, because Discord asks for a
          captcha on all three and this client had nowhere to show one. It
          has now - a window of moho's own, on Discord's origin, where the
          widget is the same widget their client uses (see main/captcha.ts) -
          so these do the thing rather than pointing at where to do it. If a
          challenge comes back, it appears; answer it and the action carries
          on where it left off. */}
      <SubmitField
        label="Join a server"
        placeholder="invite code or discord.gg/…"
        onSubmit={(invite) =>
          act(`Joined ${inviteCode(invite)}`, 'joinDiscordGuild', {
            accountId: account.id,
            invite: inviteCode(invite)
          })
        }
      />

      <SubmitField
        label="Add a friend"
        placeholder="username, or name#1234"
        onSubmit={(username) =>
          act(`Asked ${username}`, 'addDiscordFriend', { accountId: account.id, username }, refreshFriends)
        }
      />

      <SubmitField
        label="Create a server"
        placeholder="what to call it"
        onSubmit={(name) => act(`Made ${name}`, 'createDiscordGuild', { accountId: account.id, name })}
      />

      {waiting.length > 0 && (
        <>
          <div className="join-friends-header">
            <span className="setting-text">Requests</span>
          </div>
          {waiting.map((f) => (
            <div key={f.userId} className="friend-row request">
              {f.avatarUrl ? (
                <img className="friend-avatar" src={resolveMediaUrl(f.avatarUrl)} alt="" />
              ) : (
                <span className="friend-avatar placeholder">{(f.globalName || f.username).slice(0, 1)}</span>
              )}
              <span className="ellipsis">{f.globalName || f.username}</span>
              <span className="small muted">
                {f.kind === 'incoming' ? 'wants to be friends' : 'asked, waiting'}
              </span>
              {f.kind === 'incoming' && (
                <button type="button" className="button" onClick={() => answer(f.userId, true)}>
                  Accept
                </button>
              )}
              {/* Refusing one and taking back your own are the same call, and
                  read differently enough to be worth different words. */}
              <button type="button" className="button subtle" onClick={() => answer(f.userId, false)}>
                {f.kind === 'incoming' ? 'Decline' : 'Cancel'}
              </button>
            </div>
          ))}
        </>
      )}

      <div className="join-friends-header">
        <span className="setting-text">Friends</span>
        <button
          type="button"
          className={onlineOnly ? 'tab active' : 'tab'}
          onClick={() => setOnlineOnly(true)}
        >
          Online
        </button>
        <button
          type="button"
          className={!onlineOnly ? 'tab active' : 'tab'}
          onClick={() => setOnlineOnly(false)}
        >
          All
        </button>
        <button type="button" className="icon-button" title="Refresh" onClick={refreshFriends}>
          <Icon name="refresh" size={16} />
        </button>
        <button
          type="button"
          className={picking ? 'tab active' : 'tab'}
          title="Start a message with several people at once"
          onClick={() => setPicking(picking ? null : [])}
        >
          <Icon name="group_add" size={15} />
          {picking ? 'Cancel' : 'Group'}
        </button>
      </div>

      {picking && (
        <div className="group-dm-bar small">
          <span className="muted">
            {picking.length === 0
              ? 'Pick the people to start a group message with.'
              : `${picking.length} selected${picking.length >= GROUP_DM_MAX ? ' — that is the most Discord allows' : ''}`}
          </span>
          <button
            type="button"
            className="button"
            // One person is not a group: Discord would answer the list form
            // with a brand-new two-person group sitting beside the DM you
            // already have with them, which is not what picking one name
            // means.
            disabled={picking.length < 2}
            onClick={() =>
              void window.moho
                .rpc<{ bufferId: string }>('openDiscordGroupDm', {
                  accountId: account.id,
                  userIds: picking
                })
                .then((r) => {
                  setPicking(null)
                  return store.selectBuffer(r.bufferId)
                })
                .catch((e: Error) => store.toast('error', e.message))
            }
          >
            Start group
          </button>
        </div>
      )}

      {shown.length === 0 && (
        <p className="small muted">{onlineOnly ? 'No friends online.' : 'No friends yet.'}</p>
      )}

      {shown.map((f) => (
        <button
          key={f.userId}
          type="button"
          className={classes('friend-row', picking?.includes(f.userId) && 'picked')}
          // Where taking somebody off the list lives. Not a button on the row:
          // the row is itself a button - clicking it opens the conversation -
          // and a remove sitting permanently beside a name is a remove that
          // eventually gets pressed by accident.
          onContextMenu={(e) => {
            if (picking) return
            e.preventDefault()
            setFriendMenu({ x: e.clientX, y: e.clientY, friend: f })
          }}
          onClick={() => {
            if (picking) {
              const has = picking.includes(f.userId)
              if (!has && picking.length >= GROUP_DM_MAX) {
                store.toast('info', `A group message holds ${GROUP_DM_MAX + 1} people including you.`)
                return
              }
              setPicking(has ? picking.filter((id) => id !== f.userId) : [...picking, f.userId])
              return
            }
            void window.moho
              .rpc<{ bufferId: string }>('openDiscordDm', { accountId: account.id, userId: f.userId })
              .then((r) => store.selectBuffer(r.bufferId))
              .catch((e: Error) => store.toast('error', e.message))
          }}
        >
          {picking && (
            <Icon name={picking.includes(f.userId) ? 'check_circle' : 'radio_button_unchecked'} size={16} />
          )}
          {f.avatarUrl ? (
            <img className="friend-avatar" src={resolveMediaUrl(f.avatarUrl)} alt="" />
          ) : (
            <span className="friend-avatar placeholder">{(f.globalName || f.username).slice(0, 1)}</span>
          )}
          <span className="ellipsis">{f.globalName || f.username}</span>
          <span className="small muted ellipsis">{f.username}</span>
          <span className={`presence-dot ${f.status || 'offline'}`} />
        </button>
      ))}

      {friendMenu && (
        <ContextMenu
          x={friendMenu.x}
          y={friendMenu.y}
          entries={[
            {
              label: 'Message',
              icon: 'chat',
              onClick: () =>
                void window.moho
                  .rpc<{ bufferId: string }>('openDiscordDm', {
                    accountId: account.id,
                    userId: friendMenu.friend.userId
                  })
                  .then((r) => store.selectBuffer(r.bufferId))
                  .catch((e: Error) => store.toast('error', e.message))
            },
            { separator: true },
            {
              label: `Remove ${friendMenu.friend.globalName || friendMenu.friend.username}`,
              icon: 'person_remove',
              danger: true,
              onClick: () => removeFriend(friendMenu.friend)
            }
          ]}
          onClose={() => setFriendMenu(null)}
        />
      )}

      {/* Several ids make a group, one makes the ordinary DM - the same rule
          the daemon follows, so a comma is the only difference between the
          two and nobody has to find a second field. */}
      <SubmitField
        label="Message by user ID"
        placeholder="numeric user id, or several separated by commas"
        onSubmit={(entered) => {
          const ids = entered
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean)
          if (ids.length === 0) return
          const [method, params] =
            ids.length === 1
              ? ['openDiscordDm', { accountId: account.id, userId: ids[0] }]
              : ['openDiscordGroupDm', { accountId: account.id, userIds: ids }]
          void window.moho
            .rpc<{ bufferId: string }>(method as string, params as Record<string, unknown>)
            .then((r) => store.selectBuffer(r.bufferId))
            .catch((e: Error) => store.toast('error', e.message))
        }}
      />
    </div>
  )
}
