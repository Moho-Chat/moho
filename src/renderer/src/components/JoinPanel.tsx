import { XmppJoin } from './XmppJoin'
import { useMediaUrl } from '../lib/route'
import { SwitchRow } from './Switch'
import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { AccountFace, AccountList, MasterDetail, StatePill, accountWhere, askAccountsFor } from './AccountList'
import { fuzzyFilter } from '../lib/fuzzy'
import { ActionField, Initial, JoinAction, JoinListHead, JoinRow, JoinSection } from './JoinParts'
import { ContextMenu } from './ContextMenu'
import { RoomSearch } from './RoomSearch'
import { useChat, useStore } from '../state/hooks'
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

/** The services this pane has a page for. */
const JOINABLE = ['irc', 'matrix', 'discord', 'kick', 'sneedchat', 'steam', 'twitch', 'telegram', 'stoat', 'xmpp', 'signal']

/**
 * The "+" pane: every account down the left, and what can be added or joined
 * on the chosen one on the right (#339).
 *
 * Per-protocol pages rather than one generic "join by name" field: each
 * service's mechanism is genuinely different (IRC joins by channel name,
 * Matrix takes a room id or alias, Kick names a streamer, Signal a username),
 * and flattening them into one box would just mean a field that silently
 * means five things. What they share is their shape - the same sections in
 * the same order, built from the parts in JoinParts.
 *
 * It opens on the account whose "+" was clicked. Which account it is for used
 * to be a row of chips reading "salastil · IRC" three times over; it is the
 * same list Settings → Accounts shows now, with the network and the state.
 */
export function JoinPanel(): JSX.Element {
  const accountId = useChat((s) => s.joinPanelAccountId)
  const all = useChat((s) => s.accounts)
  const store = useStore()
  // In a narrow window the list and the page are two steps. It opens on the
  // page, since the account is already decided; the way back shows the list.
  const [picking, setPicking] = useState(false)

  const joinable = all.filter((a) => JOINABLE.includes(a.service))
  const account = all.find((a) => a.id === accountId) ?? joinable[0]
  if (!account) return <div className="panel muted">No account selected.</div>

  const call = (connected: boolean): void => {
    void window.moho
      .rpc('setAccountConnected', { accountId: account.id, connected })
      .then(() => store.refreshAccounts())
      .catch((e: Error) => store.toast('error', e.message))
  }

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
      case 'stoat':
        return <StoatJoin account={account} />
      case 'xmpp':
        return <XmppJoin account={account} />
      case 'signal':
        return <SignalJoin account={account} />
      case 'sneedchat':
        return <SneedchatRooms account={account} />
      case 'steam':
        return <SteamJoin account={account} />
      default:
        return <p className="muted">Joining isn&apos;t supported for this service yet.</p>
    }
  })()

  const offline = account.state !== 'connected' && account.state !== 'connecting'

  return (
    <MasterDetail
      chosen={!picking}
      onBack={() => setPicking(true)}
      backLabel="Accounts"
      pageKey={account.id}
      list={
        <AccountList
          accounts={joinable}
          selected={account.id}
          onSelect={(id) => {
            setPicking(false)
            store.setActivePanel('join', id)
          }}
          label="Add or join on"
        >
          {/* "+" is where somebody looks for this, whatever page it lives on. */}
          <button
            type="button"
            data-add-account
            className="account-list-add"
            onClick={() => {
              askAccountsFor({ add: true })
              store.setActivePanel('accounts')
            }}
          >
            <span className="account-list-add-mark">
              <Icon name="add" size={18} />
            </span>
            Add an account
          </button>
        </AccountList>
      }
    >
      <div className="page join-page">
        <header className="page-head">
          <AccountFace account={account} size={48} />
          <div className="page-head-text">
            <h2 className="page-title ellipsis">{account.displayName || account.id}</h2>
            <p className="page-sub">
              <StatePill account={account} />
              <span className="ellipsis">{accountWhere(account)}</span>
            </p>
          </div>
          <button
            type="button"
            className="button quiet"
            title="This account's settings"
            onClick={() => {
              askAccountsFor({ accountId: account.id })
              store.setActivePanel('accounts')
            }}
          >
            <Icon name="settings" size={16} /> Account
          </button>
        </header>
        {/* Nearly everything below needs the connection, so it is said once, here, with the way to get one. */}
        {offline && (
          <div className="page-banner tone-off" role="status">
            <Icon name="cloud_off" size={20} />
            <div className="page-banner-text">
              <div className="page-banner-title">This account is not connected</div>
              <div className="page-banner-detail">Joining and messaging need it online.</div>
            </div>
            <button type="button" className="button primary" onClick={() => call(true)}>
              Connect
            </button>
          </div>
        )}
        {body}
      </div>
    </MasterDetail>
  )
}

function IrcJoin({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  return (
    <>
      <JoinSection kind="people">
        <JoinAction icon="chat" title="Message someone" help="Opens a private conversation with a nick on this network.">
          <ActionField
            placeholder="nick"
            verb="Message"
            // IRC has no "open a DM" call - a query buffer only exists once
            // something is sent, so this joins a buffer named for the nick.
            onSubmit={(nick) => void store.joinAndOpen(account.id, nick)}
          />
        </JoinAction>
      </JoinSection>
      <JoinSection kind="join">
        <JoinAction icon="tag" title="Join a channel" help="By its name. A channel nobody is in yet is made by joining it.">
          <ActionField placeholder="#channel" verb="Join" onSubmit={(name) => void store.joinAndOpen(account.id, name)} />
        </JoinAction>
      </JoinSection>
      <JoinSection kind="browse">
        <IrcChannelBrowser account={account} />
      </JoinSection>
    </>
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
    <JoinAction
      icon="travel_explore"
      title="The network's channels"
      help={
        directory
          ? `${directory.total.toLocaleString()} channels, busiest first${
              directory.matching !== directory.total ? ` — ${directory.matching.toLocaleString()} matching` : ''
            }${directory.matching > directory.channels.length ? `; the busiest ${directory.channels.length} shown` : ''}`
          : 'Asked for rather than shown: a big network answers with tens of thousands, and some refuse.'
      }
      aside={
        asking ? (
          <button type="button" className="button quiet" onClick={stopWaiting}>
            Stop waiting
          </button>
        ) : (
          <button type="button" className={directory ? 'button quiet' : 'button primary'} disabled={!serverBuffer} onClick={ask}>
            <Icon name={directory ? 'refresh' : 'list'} size={16} />
            {directory ? 'Refresh' : 'List channels'}
          </button>
        )
      }
    >
      {asking && (
        <p className="small muted join-note">
          <span className="spinner" /> Asking the network. A busy one can take a minute to answer, and some refuse the
          request entirely.
        </p>
      )}
      {problem && <p className="small error-text join-note">{problem}</p>}

      {directory && (
        <>
          <input
            className="text-field"
            placeholder="Filter by name or topic"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
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
    </JoinAction>
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
    <JoinSection kind="join">
      <JoinAction
        icon="live_tv"
        title="Open a streamer's chat"
        help="Kick chat is public, so this works signed out. Signing in adds talking, and your subscriber emotes for the channels you subscribe to."
      >
        <ActionField placeholder="handle, or a kick.com link" verb="Open" onSubmit={(name) => void store.joinAndOpen(account.id, name)} />
      </JoinAction>
    </JoinSection>
  )
}

function TwitchJoin({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  return (
    <JoinSection kind="join">
      <JoinAction
        icon="live_tv"
        title="Open a streamer's chat"
        help="Twitch chat is public, so this works without signing in. Signing in adds talking and the channels you follow. A channel that does not exist is said so and not kept."
      >
        <ActionField placeholder="channel name, or a twitch.tv link" verb="Open" onSubmit={(name) => void store.joinAndOpen(account.id, name)} />
      </JoinAction>
    </JoinSection>
  )
}

/** Joining a Stoat server by its invite, and asking somebody to be a friend. */
function StoatJoin({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const [friend, setFriend] = useState('')
  const [busy, setBusy] = useState(false)
  const [people, setPeople] = useState<StoatPeople>({ friends: [], outgoing: [], blocked: [] })
  const connected = account.state === 'connected'

  // Friends, the requests still waiting on the other side, and who is blocked. The daemon says them again
  // whenever any relationship changes, and the first reading is asked for.
  useEffect(() => {
    let live = true
    if (connected) {
      void window.moho
        .rpc<StoatPeople>('stoatFriendRequests', { accountId: account.id })
        .then((r) => live && setPeople(r))
        .catch(() => {})
    }
    const off = window.moho.onEvent((e) => {
      if (e.event !== 'stoatFriendRequests') return
      const d = e.data as Partial<StoatPeople> & { accountId?: string }
      if (d.accountId === account.id) setPeople({ friends: d.friends ?? [], outgoing: d.outgoing ?? [], blocked: d.blocked ?? [] })
    })
    return () => {
      live = false
      off()
    }
  }, [account.id, connected])

  const act = (method: string, params: Record<string, unknown>, done?: string): void => {
    void window.moho
      .rpc(method, { accountId: account.id, ...params })
      .then(() => done && store.toast('info', done))
      .catch((e: Error) => store.toast('error', e.message))
  }
  const label = (p: StoatPerson): string => p.name || p.id
  const ask = (): void => {
    const typed = friend.trim()
    if (!typed) return
    setBusy(true)
    void window.moho
      .rpc('addStoatFriend', { accountId: account.id, username: typed })
      .then(() => {
        setFriend('')
        store.toast('info', `Friend request sent to ${typed}`)
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }
  return (
    <>
      <JoinSection kind="people">
        <JoinAction
          icon="person_add"
          title="Add a friend"
          help="Somebody who asks to be your friend waits as a tile in the server list, where you answer."
        >
          <ActionField
            placeholder="Their name and number, like name#1234"
            verb="Add friend"
            value={friend}
            onChange={setFriend}
            keep
            disabled={!connected}
            busy={busy}
            onSubmit={ask}
          />
        </JoinAction>
        {people.friends.length > 0 && (
          <>
            <JoinListHead>Friends</JoinListHead>
            {people.friends.map((p) => (
              <JoinRow key={p.id} face={<Initial name={label(p)} />} name={label(p)} sub={p.statusText || (p.online ? 'Online' : 'Offline')}>
                <button type="button" className="button quiet small" onClick={() => void store.openDirectMessage(account.id, p.id, label(p))}>
                  Message
                </button>
                <button type="button" className="button quiet small" onClick={() => act('answerStoatFriendRequest', { userId: p.id, accept: false }, `Removed ${label(p)}`)}>
                  Remove
                </button>
              </JoinRow>
            ))}
          </>
        )}
        {people.outgoing.length > 0 && (
          <>
            <JoinListHead>Waiting for them to accept</JoinListHead>
            {people.outgoing.map((p) => (
              <JoinRow key={p.id} face={<Initial name={label(p)} />} name={label(p)}>
                <button type="button" className="button quiet small" onClick={() => act('answerStoatFriendRequest', { userId: p.id, accept: false })}>
                  Cancel request
                </button>
              </JoinRow>
            ))}
          </>
        )}
      </JoinSection>

      <JoinSection kind="join">
        <JoinAction icon="login" title="Join a server" help="Closing a server from its menu leaves it, unless you own it.">
          <ActionField placeholder="An invite link, or its code" verb="Join" onSubmit={(code) => void store.joinAndOpen(account.id, code)} />
        </JoinAction>
      </JoinSection>
    </>
  )
}

/** One person on a Stoat account's friends page. */
interface StoatPerson {
  id: string
  name: string | null
  online?: boolean
  statusText?: string | null
}

interface StoatPeople {
  friends: StoatPerson[]
  outgoing: StoatPerson[]
  blocked: StoatPerson[]
}

function TelegramJoin({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<'group' | 'channel'>('group')
  const [about, setAbout] = useState('')
  const [members, setMembers] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.moho.rpc<{ bufferId: string; note?: string | null }>('createTelegramChat', { accountId: account.id, title: title.trim(), kind, about, members })
      setTitle('')
      setAbout('')
      setMembers('')
      if (r.note) store.toast('info', r.note)
      await store.refreshBuffers()
      await store.selectBuffer(r.bufferId)
    } catch (e) {
      store.toast('error', `Couldn't make the ${kind}: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <JoinSection kind="join">
        <JoinAction
          icon="alternate_email"
          title="Join a chat, or message someone"
          help="A public group or channel is joined by its @name or t.me link, a private one by the invite link somebody gave you, and a person's @name opens a conversation with them. Telegram may ask an administrator to accept a request to join. Closing a chat in the list leaves it."
        >
          <ActionField placeholder="@name, or a t.me link" verb="Open" onSubmit={(name) => void store.joinAndOpen(account.id, name)} />
        </JoinAction>
      </JoinSection>

      <JoinSection kind="create">
        <JoinAction
          icon={kind === 'channel' ? 'campaign' : 'group_add'}
          title={kind === 'channel' ? 'Make a channel' : 'Make a group'}
          help={
            kind === 'channel'
              ? 'You post, others read. Private until you give it a public @name in Telegram; its invite link is in its settings.'
              : 'Everybody talks, and you own it. People whose privacy settings keep them from being added are said to be; send them the invite link from its settings.'
          }
          aside={
            <div className="segmented" role="group" aria-label="What to make">
              <button type="button" className={kind === 'group' ? 'active' : undefined} onClick={() => setKind('group')}>
                Group
              </button>
              <button type="button" className={kind === 'channel' ? 'active' : undefined} onClick={() => setKind('channel')}>
                Channel
              </button>
            </div>
          }
        >
          <input className="text-field" placeholder="Its name" maxLength={128} value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
          <input className="text-field" placeholder="What it is about (optional)" maxLength={255} value={about} disabled={busy} onChange={(e) => setAbout(e.target.value)} />
          <div className="action-field">
            <input
              className="text-field"
              placeholder={kind === 'channel' ? 'Subscribers to add: @names, separated by commas' : 'Who is in it: @names, separated by commas'}
              value={members}
              disabled={busy}
              onChange={(e) => setMembers(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && title.trim() && void create()}
            />
            <button type="button" className="button primary" disabled={busy || !title.trim()} onClick={() => void create()}>
              {kind === 'channel' ? 'Make channel' : 'Make group'}
            </button>
          </div>
        </JoinAction>
      </JoinSection>
    </>
  )
}

/**
 * Starting a Signal conversation, by username (a name, a dot and a number) or by phone number: one the phone knows, else
 * looked up with Signal's contact discovery (an enclave sees the number; through the account's route when it has one).
 * Somebody who chose not to be found by number is said to be so.
 */
function SignalJoin({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const [groupName, setGroupName] = useState('')
  const [members, setMembers] = useState('')
  // A group link opened from a message arrives here to be looked at, and is taken so it is not offered twice.
  const opened = useChat((s) => s.signalGroupLink)
  const [link, setLink] = useState(opened)
  useEffect(() => {
    if (!opened) return
    setLink(opened)
    store.takeSignalGroupLink()
  }, [opened, store])
  const [preview, setPreview] = useState<{ title: string; memberCount: number; needsApproval: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      // People are named by username here; the daemon finds who each is before the group is made.
      const userIds = members.split(',').map((s) => s.trim()).filter(Boolean)
      const r = await window.moho.rpc<{ bufferId: string }>('signalCreateGroup', { accountId: account.id, title: groupName.trim(), userIds })
      setGroupName('')
      setMembers('')
      await store.refreshBuffers()
      await store.selectBuffer(r.bufferId)
    } catch (e) {
      store.toast('error', `Couldn't make the group: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const look = async (): Promise<void> => {
    setBusy(true)
    try {
      setPreview(await window.moho.rpc('signalGroupLinkInfo', { accountId: account.id, link: link.trim() }))
    } catch (e) {
      store.toast('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const join = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.moho.rpc<{ bufferId: string | null; waiting: boolean }>('signalJoinGroupLink', { accountId: account.id, link: link.trim() })
      setLink('')
      setPreview(null)
      if (r.waiting) {
        store.toast('info', 'Asked to join. An admin of the group has to let you in')
      } else if (r.bufferId) {
        await store.refreshBuffers()
        await store.selectBuffer(r.bufferId)
      }
    } catch (e) {
      store.toast('error', `Couldn't join: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <JoinSection kind="people">
        <JoinAction
          icon="chat"
          title="Message somebody"
          help="Somebody who has not accepted you yet sees your first message as a request. A number nobody has given this account cannot be looked up from here: ask for their username, or start the chat from your phone."
        >
          <ActionField
            placeholder="Their username, like name.42, or their number with its country code"
            verb="Message"
            onSubmit={(who) => void store.openDirectMessage(account.id, who, who)}
          />
        </JoinAction>
      </JoinSection>

      <JoinSection kind="join">
        <JoinAction
          icon="link"
          title="Join a group by its link"
          help={
            preview
              ? `${preview.title} · ${preview.memberCount} ${preview.memberCount === 1 ? 'member' : 'members'}${preview.needsApproval ? ' · an admin approves who joins' : ''}`
              : 'The link is looked at first, so you see what it is before joining.'
          }
        >
          <ActionField
            placeholder="https://signal.group/#…"
            verb={preview ? (preview.needsApproval ? 'Ask to join' : 'Join') : 'Look'}
            value={link}
            onChange={(v) => {
              setLink(v)
              setPreview(null)
            }}
            keep
            busy={busy}
            onSubmit={() => void (preview ? join() : look())}
          />
        </JoinAction>
      </JoinSection>

      <JoinSection kind="create">
        <JoinAction icon="group_add" title="Make a group" help="You are its admin. Anybody who cannot be added straight away is invited instead.">
          <input className="text-field" placeholder="Its name" value={groupName} disabled={busy} onChange={(e) => setGroupName(e.target.value)} />
          <div className="action-field">
            <input
              className="text-field"
              placeholder="Who is in it: usernames, separated by commas"
              value={members}
              disabled={busy}
              onChange={(e) => setMembers(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && groupName.trim() && void create()}
            />
            <button type="button" className="button primary" disabled={busy || !groupName.trim()} onClick={() => void create()}>
              Make group
            </button>
          </div>
        </JoinAction>
      </JoinSection>
    </>
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
    return () => {
      live = false
      off()
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
    <>
      <JoinSection kind="people">
        <JoinAction
          icon="person_add"
          title="Add a friend"
          help={connected ? 'Those who have asked you wait as tiles in the server list, where you answer.' : 'Friends can be added once this account is connected.'}
        >
          <ActionField
            placeholder="Account name, Steam id, friend code or invite link"
            verb="Add friend"
            value={target}
            onChange={setTarget}
            keep
            disabled={!connected}
            busy={busy}
            onSubmit={ask}
          />
        </JoinAction>
        {requests.outgoing.length > 0 && (
          <>
            <JoinListHead>Waiting for them to accept</JoinListHead>
            {requests.outgoing.map((p) => (
              <JoinRow key={p.steamid} face={<Initial name={label(p)} />} name={label(p)}>
                <button type="button" className="button quiet small" onClick={() => withdraw(p)}>
                  Cancel request
                </button>
              </JoinRow>
            ))}
          </>
        )}
      </JoinSection>

      <JoinSection kind="join">
        <JoinAction icon="group" title="Join a group" help="By the invite link somebody gave you.">
          <ActionField
            placeholder="An invite link, like s.team/chat/…"
            verb="Join"
            value={groupLink}
            onChange={setGroupLink}
            keep
            disabled={!connected}
            busy={busy}
            onSubmit={joinGroup}
          />
        </JoinAction>
      </JoinSection>

      <JoinSection kind="create">
        <JoinAction icon="group_add" title="Start a group" help="A group chat of your own, to invite friends to.">
          <ActionField
            placeholder="A name for it"
            verb="Create"
            value={groupName}
            onChange={setGroupName}
            keep
            disabled={!connected}
            busy={busy}
            onSubmit={makeGroup}
          />
        </JoinAction>
      </JoinSection>

      {/* A link anybody can add this account by, even if it takes no requests
          from strangers: good for a month, and taken back here. */}
      {connected && links !== null && (
        <JoinSection kind="manage" label="Your invite links">
          <JoinAction
            icon="link"
            title="A link that lets whoever has it add you"
            help={links.length === 0 ? 'None yet. Each is good for thirty days.' : 'Each is good for thirty days.'}
            aside={
              <button type="button" className="button quiet" onClick={() => changeLinks('create')}>
                Make a link
              </button>
            }
          />
          {links.map((l) => (
            <JoinRow key={l.token} name={<span className="selectable">{l.link}</span>} title={l.link}>
              <button type="button" className="button quiet small" onClick={() => copy(l.link)}>
                Copy
              </button>
              <button type="button" className="button quiet small" onClick={() => changeLinks('revoke', l.token)}>
                Revoke
              </button>
            </JoinRow>
          ))}
        </JoinSection>
      )}
    </>
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
      <JoinAction
        icon="add_circle"
        title="Create a room or space"
        help="A room is a place to talk; a space holds other rooms."
        aside={
          <button type="button" className="button quiet" onClick={() => setOpen(true)}>
            New room…
          </button>
        }
      />
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
    <JoinAction icon="add_circle" title={isSpace ? 'New space' : 'New room'} help="It appears in the list once the homeserver confirms it.">
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
      <div className="join-buttons">
        <button type="button" className="button primary" disabled={busy || !name.trim()} onClick={create}>
          {busy ? 'Creating…' : isSpace ? 'Create space' : 'Create room'}
        </button>
        <button type="button" className="button quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </JoinAction>
  )
}

function MatrixJoin({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  return (
    <>
      <JoinSection kind="people">
        <JoinAction icon="chat" title="Message someone" help="Starts a direct message with a Matrix address.">
          <ActionField
            placeholder="@user:server"
            verb="Message"
            onSubmit={(userId) =>
              void window.moho
                .rpc<{ bufferId: string }>('openMatrixDm', { accountId: account.id, userId, displayName: '' })
                .then((r) => store.selectBuffer(r.bufferId))
                .catch((e: Error) => store.toast('error', e.message))
            }
          />
        </JoinAction>
      </JoinSection>
      <JoinSection kind="join">
        <JoinAction icon="tag" title="Join a room or space" help="By its address or its id. A space is joined the same way as a room.">
          <ActionField
            // A Space is just a room with an m.space creation type, joined through
            // this same endpoint - no separate mechanism needed.
            placeholder="#room:server or !roomid:server"
            verb="Join"
            onSubmit={(roomIdOrAlias) =>
              // Named by what was typed until the room says otherwise: an address
              // is what somebody has in hand here, and a row called by it is
              // better than no row while the join happens.
              void store
                .joinMatrixRoom(account.id, roomIdOrAlias, roomIdOrAlias)
                .catch((e: Error) => store.toast('error', e.message))
            }
          />
        </JoinAction>
      </JoinSection>
      <JoinSection kind="create">
        <CreateMatrixRoom account={account} />
      </JoinSection>
      <JoinSection kind="browse">
        <FindRoomButton account={account} />
      </JoinSection>
    </>
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
    <JoinAction
      icon="travel_explore"
      title="Find a public room"
      help="Searches the room directories of every homeserver you name."
      aside={
        <button type="button" className="button primary" onClick={() => setOpen(true)}>
          <Icon name="search" size={16} /> Search rooms
        </button>
      }
    >
      {open && <RoomSearch account={account} onClose={() => setOpen(false)} />}
    </JoinAction>
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
  const [catalogue, setCatalogue] = useState<{ id: string; name: string }[]>([])
  const [asking, setAsking] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setAsking(true)
    void window.moho
      .rpc<{ rooms: { id: string; name: string }[] }>('listSneedChatRooms', { accountId: account.id })
      .then((r) => live && r.rooms?.length && setCatalogue(r.rooms))
      .catch((e: Error) => live && setError(e.message))

    const stop = window.moho.onEvent((frame) => {
      if (frame.event !== 'sneedchatRooms') return
      const data = frame.data as { accountId: string; rooms: { id: string; name: string }[] }
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

  const toggle = (id: string, on: boolean): void => {
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
    <JoinSection kind="join" label={asking ? 'Rooms — asking the site…' : 'Rooms'}>
      <JoinAction
        icon="forum"
        title="The rooms this account stays in"
        help={
          // Closing every room is allowed: the account stays signed in, and
          // this is where one is opened again. Closing a room deletes its
          // history, which is why switching one off is not undone by switching it on.
          enabled.length === 0 ? 'No rooms open. Switch one on to join it.' : 'Switching a room off closes it and deletes its history.'
        }
      >
        {error && (
          <p className="small muted join-note">
            Could not read the site&apos;s room list ({error}) — showing only the rooms this account has open.
          </p>
        )}
      </JoinAction>
      {rooms.map((room) => (
        <SwitchRow
          key={room.id}
          title={`#${room.name}`}
          checked={enabled.some((r) => r.id === room.id)}
          onChange={(on) => toggle(room.id, on)}
        />
      ))}
    </JoinSection>
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
  const [query, setQuery] = useState('')
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
  // Searching looks through everybody: somebody typing a name wants that
  // person, whether or not they happen to be online.
  const shown = query.trim()
    ? fuzzyFilter(settled, query, (f) => [f.globalName || f.username, f.username])
    : onlineOnly
      ? settled.filter((f) => f.status && f.status !== 'offline')
      : settled

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

  const open = (userId: string): void =>
    void window.moho
      .rpc<{ bufferId: string }>('openDiscordDm', { accountId: account.id, userId })
      .then((r) => store.selectBuffer(r.bufferId))
      .catch((e: Error) => store.toast('error', e.message))

  return (
    <>
      {/* Done in Discord's web app, in the browser, rather than here: said
          once rather than three times. First, since it is short and what is
          under it - the friends - is as long as the account has friends. */}
      <JoinSection kind="elsewhere" label="Only on discord.com">
        <JoinAction
          icon="open_in_new"
          title="Joining a server, adding a friend, creating a server"
          help="Discord puts each of these behind a captcha, and a third-party client that answers one gets the account flagged for spam. So moho leaves them to Discord's own app; what you do there shows up here."
        >
          <div className="join-buttons">
            {ON_DISCORD_ONLY.map((item) => (
              <button
                key={item.label}
                type="button"
                className="button quiet join-elsewhere"
                title={`${item.why} Opens discord.com in your browser.`}
                onClick={() => void window.moho.openExternal(DISCORD_WEB)}
              >
                <Icon name={item.icon} size={16} />
                {item.label}
                <Icon name="open_in_new" size={14} />
              </button>
            ))}
          </div>
        </JoinAction>
      </JoinSection>

      <JoinSection kind="people">
        <JoinAction
          icon="group"
          title="Friends"
          help={
            picking
              ? picking.length === 0
                ? 'Pick the people to start a group message with.'
                : `${picking.length} selected${picking.length >= GROUP_DM_MAX ? ' — that is the most Discord allows' : ''}`
              : 'Click a friend to open your conversation; right-click for more.'
          }
          aside={
            <div className="join-tools">
              <div className="segmented" role="group" aria-label="Which friends">
                <button type="button" className={onlineOnly ? 'active' : undefined} onClick={() => setOnlineOnly(true)}>
                  Online
                </button>
                <button type="button" className={!onlineOnly ? 'active' : undefined} onClick={() => setOnlineOnly(false)}>
                  All
                </button>
              </div>
              <button type="button" className="icon-button" title="Refresh" onClick={refreshFriends}>
                <Icon name="refresh" size={16} />
              </button>
              {picking ? (
                <>
                  <button
                    type="button"
                    className="button primary"
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
                  <button type="button" className="button quiet" onClick={() => setPicking(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" className="button quiet" title="Start a message with several people at once" onClick={() => setPicking([])}>
                  <Icon name="group_add" size={16} /> New group
                </button>
              )}
            </div>
          }
        />

        {/* The list is as long as the account has friends, so it is searched
            rather than read, and scrolls in a box of its own rather than
            pushing the rest of the page away. */}
        {settled.length > 0 && (
          <label className="join-search">
            <Icon name="search" size={16} />
            <input
              placeholder={`Search ${settled.length} friend${settled.length === 1 ? '' : 's'}`}
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.stopPropagation()
                  setQuery('')
                }
                // Enter takes the best match, which is what typing a name is for.
                if (e.key === 'Enter' && query.trim() && shown[0] && !picking) open(shown[0].userId)
              }}
            />
            {query && (
              <button type="button" className="icon-button" title="Clear" onClick={() => setQuery('')}>
                <Icon name="close" size={14} />
              </button>
            )}
          </label>
        )}

        {shown.length === 0 && (
          <p className="small muted join-empty">
            {query.trim() ? `No friend matches “${query.trim()}”.` : onlineOnly ? 'No friends online.' : 'No friends yet.'}
          </p>
        )}

        <div className="join-scroll">
        {shown.map((f) => (
          <JoinRow
            key={f.userId}
            picked={picking?.includes(f.userId)}
            face={
              <>
                {picking && <Icon name={picking.includes(f.userId) ? 'check_circle' : 'radio_button_unchecked'} size={18} fill={picking.includes(f.userId)} />}
                {f.avatarUrl ? <img className="friend-avatar" src={media(f.avatarUrl)} alt="" /> : <Initial name={f.globalName || f.username} />}
              </>
            }
            name={f.globalName || f.username}
            sub={f.username}
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
              open(f.userId)
            }}
          >
            <span className={`status-dot ${f.status || 'offline'}`} />
          </JoinRow>
        ))}
        </div>

        {waiting.length > 0 && (
          <>
            <JoinListHead>Waiting for them to accept</JoinListHead>
            {waiting.map((f) => (
              <JoinRow
                key={f.userId}
                face={f.avatarUrl ? <img className="friend-avatar" src={media(f.avatarUrl)} alt="" /> : <Initial name={f.globalName || f.username} />}
                name={f.globalName || f.username}
                sub={f.username}
              >
                <button type="button" className="button quiet small" onClick={() => answer(f.userId, false)}>
                  Cancel request
                </button>
              </JoinRow>
            ))}
          </>
        )}

        {/* Several ids make a group, one makes the ordinary DM - the same rule
            the daemon follows, so a comma is the only difference between the
            two and nobody has to find a second field. */}
        <JoinAction icon="chat" title="Message by user ID" help="For somebody who is not a friend yet. Several ids, separated by commas, start a group.">
          <ActionField
            placeholder="numeric user id, or several separated by commas"
            verb="Message"
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
        </JoinAction>
      </JoinSection>

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

    </>
  )
}
