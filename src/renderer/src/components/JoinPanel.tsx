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
    </div>
  )
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
