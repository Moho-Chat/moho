import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { classes, resolveMediaUrl } from '../lib/util'
import type { Account, DiscordFriend } from '../../../shared/wire'

/**
 * How many other people a Discord group message holds - ten including you.
 * Mirrored from the daemon so the picker can stop at the limit rather than
 * letting somebody choose eleven names and then be told no.
 */
const GROUP_DM_MAX = 9

/** Discord's own app, which is where these actions have to happen. */
const DISCORD_HOME = 'https://discord.com/channels/@me'

/**
 * The page for an invite, however it was written down.
 *
 * People paste the whole link, the short one, or just the code off the end of
 * a message, and all three mean the same server. Anything unrecognisable is
 * treated as a bare code, which is what it usually is - and if it is not,
 * Discord says so on a page far clearer than anything this could produce.
 */
function inviteUrl(entered: string): string {
  const text = entered.trim()
  const code = text
    .replace(/^https?:\/\//i, '')
    .replace(/^(www\.)?(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\//i, '')
    .split(/[?#/]/)[0]
  return `https://discord.com/invite/${encodeURIComponent(code || text)}`
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
    case 'sockchat':
      return (
        <div className="panel">
          <p className="muted">
            Sneedchat&apos;s rooms are a fixed set — add or remove them from the Sneedchat category
            in Settings rather than joining ad hoc here.
          </p>
        </div>
      )
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
          void window.moho
            .rpc('joinMatrixRoom', { accountId: account.id, roomIdOrAlias })
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
      <MatrixRoomDirectory account={account} />
      <CreateMatrixRoom account={account} />
    </div>
  )
}

interface PublicRoom {
  roomId: string
  name: string
  alias: string
  topic: string
  members: number
  avatarUrl?: string
  joined: boolean
}

/**
 * The public room directory - what Element calls exploring rooms.
 *
 * Two fields rather than one, because a directory is per homeserver: without
 * the second, this can only ever find rooms our own server happens to know
 * about, and the ordinary case for finding a community is having been told
 * which server it lives on. Blank means ours.
 *
 * Searching is explicit rather than as-you-type: each keystroke would be a
 * request to somebody else's server, and a directory search is heavy enough
 * that servers rate-limit it.
 */
function MatrixRoomDirectory({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const [query, setQuery] = useState('')
  const [server, setServer] = useState('')
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null)
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)

  const search = (since = ''): void => {
    setBusy(true)
    void window.moho
      .rpc<{ rooms: PublicRoom[]; next: string }>('searchMatrixRooms', {
        accountId: account.id,
        query,
        server,
        since
      })
      .then((result) => {
        // A page appends; a fresh search replaces. Same call either way, so
        // the difference has to be made here.
        setRooms((current) => (since && current ? [...current, ...result.rooms] : result.rooms))
        setNext(result.next)
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="field">
      <span className="small muted">Find a public room</span>
      <div className="field-row">
        <input
          className="text-field"
          placeholder="search the directory"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        <input
          className="text-field directory-server"
          placeholder="server (optional)"
          value={server}
          onChange={(e) => setServer(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        <button type="button" className="button" disabled={busy} onClick={() => search()}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </div>

      {rooms && rooms.length === 0 && (
        <p className="small muted">
          Nothing matched. A server only lists rooms it has been asked to publish, so a room can
          exist and not be here — joining by address still works.
        </p>
      )}

      {rooms && rooms.length > 0 && (
        <div className="channel-browser">
          {rooms.map((room) => (
            <button
              key={room.roomId}
              type="button"
              className="channel-browser-row"
              title={room.topic || room.alias || room.name}
              disabled={room.joined}
              onClick={() =>
                void window.moho
                  .rpc('joinMatrixRoom', {
                    accountId: account.id,
                    // The address where there is one: an alias survives a room
                    // being upgraded, and a bare room id needs the server to
                    // already know somebody in it.
                    roomIdOrAlias: room.alias || room.roomId
                  })
                  .catch((e: Error) => store.toast('error', e.message))
              }
            >
              <span className="ellipsis channel-browser-name">
                {room.name || room.alias || room.roomId}
              </span>
              <span className="small muted channel-browser-users">
                {room.joined ? 'joined' : room.members.toLocaleString()}
              </span>
              <span className="small muted ellipsis channel-browser-topic">{room.topic}</span>
            </button>
          ))}
        </div>
      )}

      {next && (
        <button type="button" className="button" disabled={busy} onClick={() => search(next)}>
          Show more
        </button>
      )}
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

  const refreshFriends = (): void => {
    void window.moho
      .rpc<DiscordFriend[]>('listDiscordFriends', { accountId: account.id })
      .then(setFriends)
      .catch(() => setFriends([]))
  }

  useEffect(refreshFriends, [account.id])

  const shown = onlineOnly ? friends.filter((f) => f.status && f.status !== 'offline') : friends

  return (
    <div className="panel join-panel">
      {/* All three of these go to Discord's own page rather than its API.
          Discord asks for a captcha on each of them from anything that is
          not its own client, and there is no honest way to answer one from
          here: solving it is the automation it exists to prevent, and its
          widget will not render outside discord.com in any case. A field
          that reliably fails is worse than a button that works, and whatever
          you do over there shows up here on the next sync. */}
      <SubmitField
        label="Join a server"
        placeholder="invite code or discord.gg/…"
        // The only one of the three that can carry what you typed: an invite
        // has a page of its own, so this lands on the accept button rather
        // than on Discord's front door.
        onSubmit={(invite) => void window.moho.openExternal(inviteUrl(invite))}
      />

      <div className="join-elsewhere-row">
        <button
          type="button"
          className="button subtle join-elsewhere"
          onClick={() => void window.moho.openExternal(DISCORD_HOME)}
        >
          <Icon name="open_in_new" size={14} />
          Create a server
        </button>
        <button
          type="button"
          className="button subtle join-elsewhere"
          onClick={() => void window.moho.openExternal(DISCORD_HOME)}
        >
          <Icon name="open_in_new" size={14} />
          Add a friend
        </button>
      </div>

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
