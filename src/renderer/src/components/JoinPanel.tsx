import { useMediaUrl } from '../lib/route'
import { SwitchRow } from './Switch'
import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { ContextMenu } from './ContextMenu'
import { RoomSearch } from './RoomSearch'
import { useChat, useStore } from '../state/hooks'
import { classes, serviceLabel } from '../lib/util'
import { steamGroupInviteCode } from '../lib/steamchat'
import type { Account, DiscordFriend } from '../../../shared/wire'

/**
 * How many other people a Discord group message holds - ten including you.
 * Mirrored from the daemon so the picker can stop at the limit rather than
 * letting somebody choose eleven names and then be told no.
 */
const GROUP_DM_MAX = 9

/**
 * What moho leaves to Discord's own web app, and why.
 *
 * Discord answers each of these with an hCaptcha when it comes from anything
 * but its own client, and answering one from a third-party client is what got
 * test accounts flagged for spam and one suspended. So moho does not attempt
 * them at all - not with the captcha shown, not without - and says why next to
 * the button that sends somebody to where they can be done.
 */
const DISCORD_WEB = 'https://discord.com/channels/@me'

const ON_DISCORD_ONLY: { label: string; icon: string; why: string }[] = [
  {
    label: 'Join a server',
    icon: 'login',
    why: 'Discord puts joining a server behind a captcha. A third-party client that answers it gets the account flagged for spam.'
  },
  {
    label: 'Add a friend',
    icon: 'person_add',
    why: 'Discord puts friend requests behind a captcha. A third-party client that answers it gets the account flagged for spam.'
  },
  {
    label: 'Create a server',
    icon: 'add_circle',
    why: 'Discord puts making a server behind a captcha. A third-party client that answers it gets the account flagged for spam.'
  }
]

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

  const store = useStore()
  const all = useChat((s) => s.accounts)
  if (!account) return <div className="panel muted">No account selected.</div>

  const body = ((): JSX.Element => {
    switch (account.service) {
      case 'irc':
        return <IrcJoin account={account} />
      case 'matrix':
        return <MatrixJoin account={account} />
      case 'discord':
        return <DiscordJoin account={account} />
      case 'kick':
        return <KickJoin account={account} />
      case 'twitch':
        return <TwitchJoin account={account} />
      case 'telegram':
        return <TelegramJoin account={account} />
      case 'sneedchat':
        return <SneedchatRooms account={account} />
      case 'steam':
        return <SteamJoin account={account} />
      default:
        return <div className="panel muted">Joining isn&apos;t supported for this service yet.</div>
    }
  })()
  const joinable = all.filter((a) => ['irc', 'matrix', 'discord', 'kick', 'sneedchat', 'steam', 'twitch', 'telegram'].includes(a.service))

  return (
    <div className="join-frame">
      {/* Which account this is for, first: it decides everything below it,
          and was only ever the one selected in the footer. */}
      {joinable.length > 1 && (
        <div className="join-picker" role="radiogroup" aria-label="Join on">
          <span className="small muted">Join on</span>
          {joinable.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={a.id === account.id}
              className={`service-chip${a.id === account.id ? ' active' : ''}`}
              onClick={() => store.setActivePanel('join', a.id)}
            >
              {a.displayName || a.id}
              <span className="small muted"> · {serviceLabel(a.service)}</span>
            </button>
          ))}
        </div>
      )}
      {body}
    </div>
  )
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
          Join
        </button>
      </div>
    </div>
  )
}

function IrcJoin({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  return (
    <div className="panel join-panel">
      <SubmitField
        label="Join a channel"
        placeholder="#channel"
        onSubmit={(name) => void store.joinAndOpen(account.id, name)}
      />
      <SubmitField
        label="Message someone"
        placeholder="nick"
        // IRC has no "open a DM" call - a query buffer only exists once
        // something is sent, so this joins a buffer named for the nick.
        onSubmit={(nick) => void store.joinAndOpen(account.id, nick)}
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
  /** One page of the network's directory, from the daemon: the window never holds the whole of it. */
  const [directory, setDirectory] = useState<{ total: number; matching: number; channels: IrcChannelListing[] } | null>(null)
  const [asking, setAsking] = useState(false)
  const [filter, setFilter] = useState('')
  const [problem, setProblem] = useState('')
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** The busiest few that match, asked of the daemon, which holds the list. */
  const fetchPage = (query: string): void => {
    void window.moho
      .rpc<{ total: number; matching: number; channels: IrcChannelListing[] }>('getIrcChannels', {
        accountId: account.id,
        query,
        limit: 200
      })
      .then(setDirectory)
      .catch((e: Error) => setProblem(e.message))
  }

  useEffect(() => {
    return window.moho.onEvent((frame) => {
      if (frame.event !== 'ircChannelList') return
      const data = frame.data as { accountId: string; count?: number; error?: string }
      if (data.accountId !== account.id) return
      if (waiting.current) clearTimeout(waiting.current)
      setAsking(false)
      // The network said no, or to come back later: said, rather than left
      // spinning for a list that is not coming.
      if (data.error) {
        setProblem(`The network did not give its list: ${data.error}`)
        return
      }
      setProblem('')
      fetchPage('')
      setFilter('')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id])

  useEffect(() => () => {
    if (waiting.current) clearTimeout(waiting.current)
  }, [])

  // Filtering is the daemon's to do, a moment after the last key.
  useEffect(() => {
    if (!directory) return
    const t = setTimeout(() => fetchPage(filter), 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  const ask = (): void => {
    if (!serverBuffer) {
      store.toast('error', 'Not connected to this network yet')
      return
    }
    setAsking(true)
    setProblem('')
    if (waiting.current) clearTimeout(waiting.current)
    // A network that never answers - some drop the request, and a few take
    // minutes - must not leave this waiting for good. A list that does arrive
    // later is still taken.
    waiting.current = setTimeout(() => {
      setAsking(false)
      setProblem('No answer after a minute. The network may be busy or may not allow the list; try again, or join a channel by name above.')
    }, 60_000)
    void window.moho.rpc('sendMessage', { bufferId: serverBuffer.id, body: '/list' }).catch((e: Error) => {
      if (waiting.current) clearTimeout(waiting.current)
      setAsking(false)
      store.toast('error', e.message)
    })
  }

  const stopWaiting = (): void => {
    if (waiting.current) clearTimeout(waiting.current)
    setAsking(false)
  }

  return (
    <div className="field">
      <span className="small muted">Browse the network&apos;s channels</span>
      <div className="field-row">
        <input
          className="text-field"
          placeholder={directory ? 'filter by name or topic' : 'ask the server for its list first'}
          value={filter}
          disabled={!directory}
          onChange={(e) => setFilter(e.target.value)}
        />
        {asking ? (
          <button type="button" className="button subtle" onClick={stopWaiting}>
            Stop waiting
          </button>
        ) : (
          <button type="button" className="button" disabled={!serverBuffer} onClick={ask}>
            {directory ? 'Refresh' : 'List channels'}
          </button>
        )}
      </div>

      {asking && (
        <p className="small muted">
          <span className="spinner" /> Asking the network. A busy one can take a minute to answer, and some refuse the
          request entirely.
        </p>
      )}
      {problem && <p className="small error-text">{problem}</p>}

      {directory && (
        <>
          <p className="small muted">
            {directory.total.toLocaleString()} channels, busiest first
            {directory.matching !== directory.total ? ` — ${directory.matching.toLocaleString()} matching` : ''}
            {directory.matching > directory.channels.length ? `; the busiest ${directory.channels.length} shown` : ''}
          </p>
          <div className="channel-browser">
            {directory.channels.map((c) => (
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
  void store.joinAndOpen(accountId, name)
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
        onSubmit={(name) => void store.joinAndOpen(account.id, name)}
      />
      <p className="small muted">
        Kick chat is public, so this works signed out. Signing in adds talking, and your
        subscriber emotes for the channels you subscribe to.
      </p>
    </div>
  )
}

function TwitchJoin({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  return (
    <div className="panel join-panel">
      <SubmitField
        label="Open a streamer's chat"
        placeholder="channel name, or a twitch.tv link"
        onSubmit={(name) => void store.joinAndOpen(account.id, name)}
      />
      <p className="small muted">
        Twitch chat is public, so this works without signing in. Signing in adds talking and the
        channels you follow. A channel that does not exist is said so and not kept.
      </p>
    </div>
  )
}

function TelegramJoin({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  return (
    <div className="panel join-panel">
      <SubmitField
        label="Join a chat, or open a conversation"
        placeholder="@name, or a t.me link"
        onSubmit={(name) => void store.joinAndOpen(account.id, name)}
      />
      <p className="small muted">
        A public group or channel is joined by its @name or t.me link, a private one by the invite link
        somebody gave you, and a person's @name opens a conversation with them. Telegram may ask an
        administrator to accept a request to join. Closing a chat in the list leaves it.
      </p>
    </div>
  )
}

/** One person in a friend request. */
interface SteamPerson {
  steamid: string
  name: string | null
  avatarUrl?: string | null
}

interface SteamRequests {
  incoming: SteamPerson[]
  outgoing: SteamPerson[]
}

/**
 * Friends on Steam: asking somebody, and taking a request back.
 *
 * Steam makes you friends by one side asking and the other agreeing. Those who
 * have asked you are not here: each waits as a tile in the server list, beside
 * a Matrix room's invitations, and is answered there. What is here is the asking,
 * and the requests still waiting on the other side.
 */
function SteamJoin({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [requests, setRequests] = useState<SteamRequests>({ incoming: [], outgoing: [] })
  const [blocked, setBlocked] = useState<{ steamid: string; name: string }[]>([])
  const [links, setLinks] = useState<{ token: string; link: string; created: number }[] | null>(null)
  const connected = account.state === 'connected'

  useEffect(() => {
    let live = true
    void window.moho
      .rpc<SteamRequests>('steamFriendRequests', { accountId: account.id })
      .then((r) => live && setRequests(r))
      .catch(() => {})
    const off = window.moho.onEvent((e) => {
      if (e.event !== 'steamFriendRequests') return
      const d = e.data as { accountId?: string; requests?: SteamRequests }
      if (d.accountId === account.id && d.requests) setRequests(d.requests)
    })
    // Who is blocked, and what links have been given out: neither has a place
    // in the conversation list, so they are here, where friends are added.
    void window.moho
      .rpc<{ steamid: string; name: string }[]>('steamBlockedList', { accountId: account.id })
      .then((b) => live && setBlocked(b))
      .catch(() => {})
    const offBlocked = window.moho.onEvent((e) => {
      if (e.event !== 'steamBlocked') return
      const d = e.data as { accountId?: string; blocked?: { steamid: string; name: string }[] }
      if (d.accountId === account.id && d.blocked) setBlocked(d.blocked)
    })
    return () => {
      live = false
      off()
      offBlocked()
    }
  }, [account.id])

  // The links, once the account is connected: they come from Steam's website.
  useEffect(() => {
    if (!connected) return
    let live = true
    void window.moho
      .rpc<{ token: string; link: string; created: number }[]>('steamInviteLinks', { accountId: account.id, action: 'list' })
      .then((l) => live && setLinks(l))
      .catch(() => live && setLinks([]))
    return () => {
      live = false
    }
  }, [account.id, connected])

  const changeLinks = (action: 'create' | 'revoke', token?: string): void => {
    void window.moho
      .rpc<{ token: string; link: string; created: number }[]>('steamInviteLinks', { accountId: account.id, action, token })
      .then(setLinks)
      .catch((e: Error) => store.toast('error', e.message))
  }

  const copy = (text: string): void => {
    // Through the main process, as everywhere else in moho: the page's own clipboard is refused here.
    void window.moho
      .copyText(text)
      .then(() => store.toast('info', 'Copied'))
      .catch(() => store.toast('error', 'Could not copy'))
  }

  const unblock = (p: { steamid: string; name: string }): void => {
    void window.moho
      .rpc('steamUnblock', { accountId: account.id, steamid: p.steamid })
      .then(() => store.toast('info', `Unblocked ${p.name}`))
      .catch((e: Error) => store.toast('error', e.message))
  }

  const label = (p: SteamPerson): string => p.name || p.steamid

  const [groupLink, setGroupLink] = useState('')
  const [groupName, setGroupName] = useState('')
  const joinGroup = (): void => {
    const typed = groupLink.trim()
    if (!typed) return
    setBusy(true)
    void window.moho
      .rpc<{ groupId: string; name?: string }>('steamChatGroupAction', { accountId: account.id, action: 'join', invite: typed })
      .then((r) => {
        setGroupLink('')
        store.toast('info', `Joined ${r.name || 'the group'}`)
        store.selectGroup(r.groupId)
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }
  const makeGroup = (): void => {
    const typed = groupName.trim()
    if (!typed) return
    setBusy(true)
    void window.moho
      .rpc<{ groupId: string }>('steamChatGroupAction', { accountId: account.id, action: 'create', name: typed })
      .then((r) => {
        setGroupName('')
        store.selectGroup(r.groupId)
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  const ask = (): void => {
    const typed = target.trim()
    if (!typed) return
    // A link to a group, pasted where a friend goes, is joined as the group it is.
    if (steamGroupInviteCode(typed)) {
      setGroupLink(typed)
      setTarget('')
      return
    }
    setBusy(true)
    void window.moho
      .rpc<{ steamid: string; name: string | null }>('steamAddFriend', { accountId: account.id, target: typed })
      .then((r) => {
        setTarget('')
        store.toast('info', `Friend request sent to ${r.name || typed}`)
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  const withdraw = (p: SteamPerson): void => {
    void window.moho
      .rpc('steamRemoveFriend', { accountId: account.id, steamid: p.steamid })
      .catch((e: Error) => store.toast('error', e.message))
  }

  return (
    <div className="panel join-panel">
      <span className="small muted">Add a friend</span>
      <div className="field-row">
        <input
          className="text-field"
          placeholder="Account name, Steam id, friend code or invite link"
          spellCheck={false}
          autoComplete="off"
          value={target}
          disabled={!connected || busy}
          onChange={(e) => setTarget(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') ask()
          }}
        />
        <button type="button" className="button" disabled={!connected || busy || !target.trim()} onClick={ask}>
          Add friend
        </button>
      </div>
      {!connected && <p className="small muted">Friends can be added once this account is connected.</p>}

      <span className="small muted">Join a group</span>
      <div className="field-row">
        <input
          className="text-field"
          placeholder="An invite link, like s.team/chat/…"
          spellCheck={false}
          autoComplete="off"
          value={groupLink}
          disabled={!connected || busy}
          onChange={(e) => setGroupLink(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') joinGroup()
          }}
        />
        <button type="button" className="button" disabled={!connected || busy || !groupLink.trim()} onClick={joinGroup}>
          Join
        </button>
      </div>
      <span className="small muted">Start a group</span>
      <div className="field-row">
        <input
          className="text-field"
          placeholder="A name for it"
          value={groupName}
          disabled={!connected || busy}
          onChange={(e) => setGroupName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') makeGroup()
          }}
        />
        <button type="button" className="button" disabled={!connected || busy || !groupName.trim()} onClick={makeGroup}>
          Create
        </button>
      </div>

      {requests.outgoing.length > 0 && (
        <>
          <span className="small muted">Waiting for them to accept</span>
          {requests.outgoing.map((p) => (
            <div key={p.steamid} className="field-row">
              <span className="grow">{label(p)}</span>
              <button type="button" className="button subtle small" onClick={() => withdraw(p)}>
                Cancel request
              </button>
            </div>
          ))}
        </>
      )}

      {/* A link anybody can add this account by, even if it takes no requests
          from strangers: good for a month, and taken back here. */}
      {connected && links !== null && (
        <>
          <span className="small muted">Your invite links</span>
          {links.length === 0 && <p className="small muted">None yet. A link lets whoever has it add you, for thirty days.</p>}
          {links.map((l) => (
            <div key={l.token} className="field-row">
              <span className="grow ellipsis" title={l.link}>
                {l.link}
              </span>
              <button type="button" className="button subtle small" onClick={() => copy(l.link)}>
                Copy
              </button>
              <button type="button" className="button subtle small" onClick={() => changeLinks('revoke', l.token)}>
                Revoke
              </button>
            </div>
          ))}
          <div className="field-row">
            <button type="button" className="button subtle small" onClick={() => changeLinks('create')}>
              Make a link
            </button>
          </div>
        </>
      )}

      {blocked.length > 0 && (
        <>
          <span className="small muted">Blocked</span>
          {blocked.map((p) => (
            <div key={p.steamid} className="field-row">
              <span className="grow ellipsis" title={p.steamid}>
                {p.name}
              </span>
              <button type="button" className="button subtle small" disabled={!connected} onClick={() => unblock(p)}>
                Unblock
              </button>
            </div>
          ))}
        </>
      )}
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
      <SwitchRow
        title="Make it a space"
        description="A container for other rooms rather than a place to talk"
        checked={isSpace}
        onChange={setIsSpace}
      />
      <SwitchRow
        title="Anyone can find and join it"
        description="Otherwise it is invite only"
        checked={isPublic}
        onChange={setIsPublic}
      />
      <SwitchRow
        title="Encrypt it"
        description="Cannot be turned off later, so a room that might need it should have it from the start"
        checked={encrypted}
        disabled={isPublic}
        onChange={setEncrypted}
      />
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

function MatrixJoin({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  return (
    <div className="panel join-panel">
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
  const enabled = account.sneedchatRooms ?? []
  /**
   * The catalogue, from the site.
   *
   * The daemon reads the room switcher off the chat page - the same list a
   * person sees down the side of the site - and answers with whatever it read
   * last, then sends the fresh one as an event a few seconds later. Nothing is
   * built in: the site names its rooms, and a list kept here would drift from
   * it. Until it answers, or if it cannot be read, the rooms this account
   * already has open are still shown, so they can always be closed.
   */
  const [catalogue, setCatalogue] = useState<{ id: number; name: string }[]>([])
  const [asking, setAsking] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setAsking(true)
    void window.moho
      .rpc<{ rooms: { id: number; name: string }[] }>('listSneedChatRooms', { accountId: account.id })
      .then((r) => live && r.rooms?.length && setCatalogue(r.rooms))
      .catch((e: Error) => live && setError(e.message))

    const stop = window.moho.onEvent((frame) => {
      if (frame.event !== 'sneedchatRooms') return
      const data = frame.data as { accountId: string; rooms: { id: number; name: string }[] }
      if (!live || data.accountId !== account.id || !data.rooms.length) return
      setCatalogue(data.rooms)
      setAsking(false)
      setError('')
    })
    return () => {
      live = false
      stop()
    }
  }, [account.id])

  const rooms = [...catalogue, ...enabled.filter((open) => !catalogue.some((r) => r.id === open.id))]

  const toggle = (id: number, on: boolean): void => {
    const room = rooms.find((r) => r.id === id)
    if (on && !room) return
    const next = on
      ? enabled.some((r) => r.id === id) || !room
        ? enabled
        : [...enabled, room]
      : enabled.filter((r) => r.id !== id)
    void window.moho
      .rpc('setSneedChatRooms', { accountId: account.id, rooms: next })
      // The ticks are the account's room list, so they follow it once it has
      // changed rather than guessing ahead of it.
      .then(() => store.refreshAccounts())
      .catch((e: Error) => store.toast('error', e.message))
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
              onChange={(e) => toggle(room.id, e.target.checked)}
            />
            <span>#{room.name}</span>
          </label>
        ))}
        {error && (
          <span className="small muted">
            Could not read the site&apos;s room list ({error}) — showing only the rooms this account
            has open.
          </span>
        )}
        {/* Closing every room is allowed: the account stays signed in, and
            this is where one is opened again. Closing a room deletes its
            history, which is why unticking is not undone by ticking. */}
        {enabled.length === 0 && (
          <span className="small muted">No rooms open. Tick one to join it.</span>
        )}
        {enabled.length > 0 && (
          <span className="small muted">Unticking a room closes it and deletes its history.</span>
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
  const media = useMediaUrl(account.id)
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

  // Requests this account has sent are their own list above the friends: not
  // people you can message yet, so filtering them by whether they happen to be
  // online - which is what the toggle below does - would hide them. The ones
  // sent to this account are not here: they wait on the Invitations tile in
  // the server list with every other question that wants a yes or a no.
  const waiting = friends.filter((f) => f.kind === 'outgoing')
  const settled = friends.filter((f) => !f.kind || f.kind === 'friend')
  const shown = onlineOnly ? settled.filter((f) => f.status && f.status !== 'offline') : settled

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
      {/* Done in Discord's web app, in the browser, rather than here. */}
      <div className="join-elsewhere-list">
        {ON_DISCORD_ONLY.map((item) => (
          <div key={item.label} className="join-elsewhere-item">
            <button
              type="button"
              className="button join-elsewhere"
              title="Opens discord.com in your browser"
              onClick={() => void window.moho.openExternal(DISCORD_WEB)}
            >
              <Icon name={item.icon} size={16} />
              {item.label} on discord.com
              <Icon name="open_in_new" size={14} />
            </button>
            <p className="small muted join-elsewhere-why">{item.why}</p>
          </div>
        ))}
      </div>

      {waiting.length > 0 && (
        <>
          <div className="join-friends-header">
            <span className="setting-text">Waiting for them to accept</span>
          </div>
          {waiting.map((f) => (
            <div key={f.userId} className="friend-row request">
              {f.avatarUrl ? (
                <img className="friend-avatar" src={media(f.avatarUrl)} alt="" />
              ) : (
                <span className="friend-avatar placeholder">{(f.globalName || f.username).slice(0, 1)}</span>
              )}
              <span className="ellipsis">{f.globalName || f.username}</span>
              <button type="button" className="button subtle" onClick={() => answer(f.userId, false)}>
                Cancel request
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
            <img className="friend-avatar" src={media(f.avatarUrl)} alt="" />
          ) : (
            <span className="friend-avatar placeholder">{(f.globalName || f.username).slice(0, 1)}</span>
          )}
          <span className="ellipsis">{f.globalName || f.username}</span>
          <span className="small muted ellipsis">{f.username}</span>
          <span className={`status-dot ${f.status || 'offline'}`} />
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
