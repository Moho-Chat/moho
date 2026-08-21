import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { resolveMediaUrl } from '../lib/util'
import type { Account, DiscordFriend } from '../../../shared/wire'

/**
 * Per-protocol join pages rather than one generic "join by name" field: each
 * service's mechanism is genuinely different (IRC joins by channel name,
 * Discord accepts an invite, Matrix takes a room id or alias, Sneedchat's
 * rooms are a fixed set edited in Settings), and flattening them into one box
 * would just mean a field that silently means four things.
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

  const refreshFriends = (): void => {
    void window.moho
      .rpc<DiscordFriend[]>('listDiscordFriends', { accountId: account.id })
      .then(setFriends)
      .catch(() => setFriends([]))
  }

  useEffect(refreshFriends, [account.id])

  const call = (method: string, params: Record<string, unknown>, note?: string): void => {
    void window.moho
      .rpc(method, params)
      .then(() => note && store.toast('info', note))
      .catch((e: Error) => store.toast('error', e.message))
  }

  const shown = onlineOnly ? friends.filter((f) => f.status && f.status !== 'offline') : friends

  return (
    <div className="panel join-panel">
      <SubmitField
        label="Join a server"
        placeholder="invite code or discord.gg/…"
        onSubmit={(invite) => call('joinDiscordGuild', { accountId: account.id, invite }, 'Joining…')}
      />
      <SubmitField
        label="Create a server"
        placeholder="server name"
        onSubmit={(name) => call('createDiscordGuild', { accountId: account.id, name }, 'Creating…')}
      />
      <SubmitField
        label="Add a friend"
        placeholder="username"
        onSubmit={(username) =>
          call('addDiscordFriend', { accountId: account.id, username }, 'Friend request sent')
        }
      />

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
      </div>

      {shown.length === 0 && (
        <p className="small muted">{onlineOnly ? 'No friends online.' : 'No friends yet.'}</p>
      )}

      {shown.map((f) => (
        <button
          key={f.userId}
          type="button"
          className="friend-row"
          onClick={() =>
            void window.moho
              .rpc<{ bufferId: string }>('openDiscordDm', { accountId: account.id, userId: f.userId })
              .then((r) => store.selectBuffer(r.bufferId))
              .catch((e: Error) => store.toast('error', e.message))
          }
        >
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

      <SubmitField
        label="DM by user ID"
        placeholder="numeric user id"
        onSubmit={(userId) =>
          void window.moho
            .rpc<{ bufferId: string }>('openDiscordDm', { accountId: account.id, userId })
            .then((r) => store.selectBuffer(r.bufferId))
            .catch((e: Error) => store.toast('error', e.message))
        }
      />
    </div>
  )
}
