import { useEffect, useMemo, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { ContextMenu, useContextMenu, type MenuEntry } from './ContextMenu'
import { useActiveBuffer, useChat, useIdSetPref, useStore } from '../state/hooks'
import { classes, hasDirectMessages, nickColor } from '../lib/util'
import { KickPoints } from './KickPoints'
import type { Member } from '../../../shared/wire'

/**
 * The member list for the active channel. Two grouping modes, both driven off
 * the same protocol-agnostic presenceChange shape:
 *
 * - "presence": online / offline, used whenever the roster carries a status -
 *   Matrix and Discord today. Sorted by power level where the protocol has
 *   one, then alphabetically.
 * - "tier": owner / moderator / regular by rank prefix, alphabetical within
 *   each. Used where there is no presence to report, which is also where rank
 *   is the more useful thing to show - IRC, and Sneedchat's site owner.
 *
 * Chosen from the data rather than from the service name, so a protocol that
 * starts reporting presence needs no change here.
 */
/**
 * What a member-list menu can ask for.
 *
 * `mute` is the one that means different things: on Matrix it lowers somebody
 * below the send threshold, on IRC it takes their voice in a moderated
 * channel. Same intent, so the same word, resolved where it is sent.
 */
export type ModerationAction = 'kick' | 'ban' | 'mute' | 'op' | 'deop' | 'voice'

/**
 * A rank word shortened to something that fits beside a name.
 *
 * Deliberately the same abbreviations the message byline uses, so the same
 * person reads the same way in both places. An unfamiliar word keeps its own
 * first letters rather than being dropped.
 */
/**
 * What hovering a member says about them.
 *
 * Everything the network has actually told us, and nothing it has not. On IRC
 * that is now a hostmask and a services account where the server offered them
 * — the two facts that say which *person* a nick belongs to — and on every
 * other service it stays what it was.
 */
function memberTitle(member: Member): string {
  const lines = [member.nick]
  if (member.account) lines.push(`identified as ${member.account}`)
  if (member.host) lines.push(member.host)
  if (lines.length === 1 && member.userId) return member.userId
  return lines.join('\n')
}

function shortBadge(prefix: string): string {
  const short: Record<string, string> = {
    broadcaster: 'HOST',
    moderator: 'MOD',
    subscriber: 'SUB',
    founder: 'FDR',
    og: 'OG',
    vip: 'VIP'
  }
  return short[prefix] ?? prefix.slice(0, 3).toUpperCase()
}

/**
 * What the local user may do in a Kick channel.
 *
 * Read off their own badge in the list, which is only there once they have
 * spoken - so a moderator who has said nothing yet is offered nothing. That
 * is the honest reading: nothing here knows they are a moderator until Kick
 * says so, and the alternative is offering actions that come back refused.
 */
function kickPermissions(members: Member[], me: string): Record<string, boolean> {
  if (!me) return {}
  const mine = members.find((m) => m.nick.toLowerCase() === me.toLowerCase())?.prefix ?? ''
  const moderator = mine === 'moderator' || mine === 'broadcaster'
  return { canKick: moderator, canBan: moderator, canMute: moderator }
}

/**
 * Why the list says what it says, for the one service where it needs saying.
 */
function rosterNote(service: string | undefined): string | undefined {
  return service === 'kick'
    ? 'Kick has no viewer list — this is everybody who has spoken here recently'
    : undefined
}

/**
 * What the local user may do in an IRC channel, read off their own prefix.
 *
 * `~` founder, `&` admin, `@` operator, `%` halfop, `+` voice - the ranks in
 * descending order, of which the top three can throw somebody out and halfop
 * usually can. Deliberately generous at the halfop boundary: networks disagree
 * about what a halfop may do, and offering an action the server then refuses
 * is a better failure than hiding one it would have allowed.
 */
function ircPermissions(members: Member[], currentNick: string): Record<string, boolean> {
  if (!currentNick) return {}
  const me = members.find((m) => m.nick.toLowerCase() === currentNick.toLowerCase())
  const prefix = me?.prefix ?? ''
  const operator = /[~&@]/.test(prefix)
  const halfop = prefix.includes('%')
  return {
    canKick: operator || halfop,
    canBan: operator || halfop,
    // "Mute" on IRC is taking somebody's voice in a moderated channel, which
    // is an operator's job rather than a halfop's on most networks.
    canMute: operator,
    canOp: operator
  }
}

/** What a Discord account may do in the guild a conversation belongs to. */
interface DiscordPowers {
  canKick?: boolean
  canBan?: boolean
  canMute?: boolean
  canAssignRoles?: boolean
  roles?: { id: string; name: string; colour?: string | null }[]
}

export function NickList(): JSX.Element {
  const store = useStore()
  const buffer = useActiveBuffer()
  const presenceByBuffer = useChat((s) => s.presenceByBuffer)
  const accounts = useChat((s) => s.accounts)
  const permissions = useChat((s) => s.matrixPermissions)
  const [blocked, toggleBlocked, isBlocked] = useIdSetPref('blockedNicks')
  const [searchActive, setSearchActive] = useState(false)
  const [query, setQuery] = useState('')

  const members = (buffer && presenceByBuffer[buffer.id]) || []
  const account = buffer && accounts.find((a) => a.id === buffer.accountId)
  // Any protocol that reports presence gets the online/offline split.
  const hasPresence = members.some((m) => m.status !== undefined)
  // Calling is Discord-only for now, and needs an account id to place from.
  const canCall = account?.service === 'discord'
  // Matrix answers this from the server, which is where its power levels live.
  // IRC's answer is already on screen: the member list carries every nick's
  // prefix, including ours, so what we may do is whatever our own prefix says.
  // Both are advisory - the server re-checks either way and refuses if we were
  // wrong, exactly as any other client would be refused.
  // Kick answers this from the badges it already sent: the local user is a
  // moderator of a channel if their own row says so. Matched on the name Kick
  // knows, never the local one - renaming yourself must not cost you your own
  // moderator buttons. Same shape as IRC's,
  // and advisory in the same way - Kick re-checks and refuses if we were
  // wrong, which it explains far better than a status code would.
  // Discord answers this from the roles it has already sent - it has no
  // endpoint for "what may I do", so its own client works this out the same
  // way. Advisory like the rest: the service re-checks and refuses.
  const [discordPowers, setDiscordPowers] = useState<DiscordPowers | null>(null)
  useEffect(() => {
    setDiscordPowers(null)
    if (account?.service !== 'discord' || !buffer) return
    void window.moho
      .rpc<DiscordPowers>('getDiscordPowers', { bufferId: buffer.id })
      .then(setDiscordPowers)
      .catch(() => {
        /* advisory only: no answer means no moderation entries */
      })
  }, [account?.service, account?.id, buffer?.id])

  const perms =
    account?.service === 'irc'
      ? ircPermissions(members, account.currentNick)
      : account?.service === 'kick'
        ? kickPermissions(members, account.currentNick)
        : account?.service === 'discord'
          ? discordPowers ?? {}
          : (buffer && permissions[buffer.id]) || {}

  const groups = useMemo(() => {
    const filtered = query
      ? members.filter((m) => m.nick.toLowerCase().includes(query.toLowerCase()))
      : members

    if (hasPresence) {
      const byPower = (a: Member, b: Member): number =>
        (b.powerLevel ?? 0) - (a.powerLevel ?? 0) || a.nick.localeCompare(b.nick)
      return [
        { label: 'Online', members: filtered.filter((m) => !m.away).sort(byPower) },
        { label: 'Offline', members: filtered.filter((m) => m.away).sort(byPower) }
      ].filter((g) => g.members.length > 0)
    }

    const byName = (a: Member, b: Member): number => a.nick.localeCompare(b.nick)
    // Guard the empty prefix explicitly: indexOf('') is 0, which is the
    // owner slot, so every unranked member - all of Sneedchat, and any
    // ordinary IRC user - was being filed under Owners.
    //
    // Kick says the same thing in words rather than symbols, since its badges
    // have names and no agreed sigils. Mapped onto the same ranks so one
    // grouping serves both rather than each protocol growing its own.
    const rank = (m: Member): number => {
      if (!m.prefix) return -1
      const named: Record<string, number> = { broadcaster: 0, moderator: 2, vip: 3, og: 4, founder: 4, subscriber: 4 }
      return m.prefix in named ? named[m.prefix] : '~&@%+'.indexOf(m.prefix)
    }
    return [
      { label: 'Owners', members: filtered.filter((m) => rank(m) === 0).sort(byName) },
      { label: 'Moderators', members: filtered.filter((m) => rank(m) > 0 && rank(m) < 4).sort(byName) },
      { label: 'Members', members: filtered.filter((m) => rank(m) === -1 || rank(m) === 4).sort(byName) }
    ].filter((g) => g.members.length > 0)
  }, [members, hasPresence, query])

  return (
    <div className="nicklist">
      <div className="nicklist-header">
        {searchActive ? (
          <input
            className="text-field small"
            autoFocus
            placeholder="Filter…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchActive(false)
                setQuery('')
              }
            }}
          />
        ) : (
          // Named for what the list actually is. Kick has no viewer list to
          // ask for - it is built from who has spoken - and calling that
          // "members" would claim to know something nobody here can know.
          <span className="small muted ellipsis" title={rosterNote(account?.service)}>
            {members.length} {account?.service === 'kick' ? 'recently talking' : 'members'}
          </span>
        )}
        <IconButton
          name={searchActive ? 'close' : 'search'}
          size={15}
          title={searchActive ? 'Clear filter' : 'Filter members'}
          onClick={() => {
            setSearchActive(!searchActive)
            if (searchActive) setQuery('')
          }}
        />
      </div>

      <div className="nicklist-scroll">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="nicklist-group small muted">
              {group.label} — {group.members.length}
            </div>
            {group.members.map((member) => (
              <MemberRow
                key={member.userId || member.nick}
                member={member}
                blockKey={`${buffer?.accountId}|${member.nick}`}
                blocked={isBlocked(`${buffer?.accountId}|${member.nick}`)}
                canOpenDm={hasDirectMessages(account?.service)}
                canWhisper={account?.service === 'sneedchat'}
                canSendFile={account?.service === 'irc'}
                canCall={canCall && !!member.userId}
                perms={perms}
                service={account?.service}
                onSetPower={(level) => {
                  if (!buffer || !account) return
                  void window.moho
                    .rpc('setMatrixPowerLevel', {
                      accountId: account.id,
                      bufferId: buffer.id,
                      userId: member.userId || member.nick,
                      level
                    })
                    .catch((e: Error) => store.toast('error', e.message))
                }}
                onToggleBlock={toggleBlocked}
                onIgnore={(ignored) => {
                  if (!account) return
                  // The protocol id where the service has one - a display
                  // name can be changed and reused, and on IRC it is all
                  // there is.
                  store.setIgnored(account.id, member.userId || member.nick, ignored)
                }}
                onMention={() => store.startReply('', member.nick, '')}
                onModerate={(action) => {
                  if (!buffer || !account) return
                  // Each protocol says this its own way. Matrix has an RPC per
                  // action because power levels are state events; IRC has the
                  // commands it has always had, typed into the channel - which
                  // is exactly what this menu existed to save somebody doing
                  // by hand, and did not, because it only ever spoke Matrix.
                  if (account.service === 'irc') {
                    // "Mute" on IRC is taking somebody's voice, which is what
                    // it means in a moderated channel - there is no separate
                    // mute to give.
                    const command = action === 'mute' ? 'devoice' : action
                    void window.moho
                      .rpc('sendMessage', { bufferId: buffer.id, body: `/${command} ${member.nick}` })
                      .catch((e: Error) => store.toast('error', e.message))
                    return
                  }
                  if (account.service === 'kick') {
                    // "Kick" is a timeout on Kick - there is nothing to
                    // remove somebody from - and "mute" means the same thing,
                    // so both become the short ban that they are.
                    const kickAction = action === 'ban' ? 'ban' : 'timeout'
                    void window.moho
                      .rpc('moderateKickUser', {
                        accountId: account.id,
                        bufferId: buffer.id,
                        username: member.nick,
                        action: kickAction,
                        minutes: 10
                      })
                      .catch((e: Error) => store.toast('error', e.message))
                    return
                  }
                  if (account.service === 'discord') {
                    // Discord's own three, and "mute" is a timeout there -
                    // the same word this menu uses everywhere, meaning what
                    // the service means by it.
                    void window.moho
                      .rpc('moderateDiscordMember', {
                        bufferId: buffer.id,
                        userId: member.userId || member.nick,
                        action,
                        minutes: 10
                      })
                      .catch((e: Error) => store.toast('error', e.message))
                    return
                  }
                  if (action === 'op' || action === 'deop' || action === 'voice') {
                    store.toast('error', 'Only IRC has channel ranks')
                    return
                  }
                  const method =
                    action === 'kick'
                      ? 'kickMatrixMember'
                      : action === 'ban'
                        ? 'banMatrixMember'
                        : 'muteMatrixMember'
                  void window.moho
                    .rpc(method, {
                      accountId: account.id,
                      bufferId: buffer.id,
                      userId: member.userId || member.nick
                    })
                    .catch((e: Error) => store.toast('error', e.message))
                }}
                onSetRole={(roleId, give) => {
                  if (!buffer) return
                  void window.moho
                    .rpc('setDiscordMemberRole', {
                      bufferId: buffer.id,
                      userId: member.userId || member.nick,
                      roleId,
                      give
                    })
                    .catch((e: Error) => store.toast('error', e.message))
                }}
                onCall={() => {
                  if (!account) return
                  store.toast('info', `Calling ${member.nick}…`)
                  void window.moho
                    .rpc<{ bufferId: string }>('callDiscordUser', {
                      accountId: account.id,
                      userId: member.userId
                    })
                    // Go to the conversation the call is in, which is where
                    // hanging up and everything else about it lives.
                    .then((r) => store.selectBuffer(r.bufferId))
                    .catch((e: Error) => store.toast('error', `Couldn't call: ${e.message}`))
                }}
                onWhisper={() => store.startWhisper(member.nick)}
                onProfile={
                  buffer ? () => store.showProfile(buffer.id, member.nick, member.userId) : undefined
                }
                onSendFile={() => account && void store.sendFileTo(account.id, member.nick)}
                onOpenDm={() => {
                  if (!account) return
                  // Which method each service wants, and whether it can work
                  // from a name or needs an id, is settled in one place rather
                  // than at every call site that offers this.
                  void store.openDirectMessage(account.id, member.userId ?? '', member.nick)
                }}
              />
            ))}
          </div>
        ))}
        {members.length === 0 && <div className="nicklist-empty small muted">No member list yet.</div>}
        {blocked.length > 0 && <div className="nicklist-group small muted">{blocked.length} blocked</div>}
      </div>
      {/* Kick's own plaque, at the foot of the list where Kick puts it. Only
          on Kick, and only in a channel - it is a standing in this room, and
          there is no such thing in a whisper. */}
      {account?.service === 'kick' && buffer?.kind === 'channel' && buffer && (
        <KickPoints bufferId={buffer.id} />
      )}
    </div>
  )
}

interface MemberRowProps {
  member: Member
  blockKey: string
  blocked: boolean
  /** The protocol can start a conversation from a member list. */
  canOpenDm: boolean
  /** Sneedchat has no conversations, but it does have private messages. */
  canWhisper: boolean
  /** IRC carries a file directly between two people; nothing else here does. */
  canSendFile: boolean
  perms: {
    canKick?: boolean
    canBan?: boolean
    canMute?: boolean
    canOp?: boolean
    canAssignRoles?: boolean
    roles?: { id: string; name: string; colour?: string | null }[]
  }
  /** Which service this row belongs to, so an action is named as it acts. */
  service: string | undefined
  onToggleBlock: (key: string) => void
  /** Tells the service, where the service has anything to be told. */
  onIgnore: (ignored: boolean) => void
  onMention: () => void
  onModerate: (action: ModerationAction) => void
  /** Gives this member a role, or takes it away. Discord only. */
  onSetRole: (roleId: string, give: boolean) => void
  /** Matrix only: give this member a power level outright. */
  onSetPower: (level: number) => void
  onOpenDm: () => void
  onWhisper: () => void
  onSendFile: () => void
  /** Only where the protocol supports it and the member is identifiable. */
  canCall: boolean
  /** Ask the service who this is. Every service answers something. */
  onProfile?: () => void
  onCall: () => void
}

function MemberRow({
  member,
  blockKey,
  blocked,
  canOpenDm,
  canWhisper,
  canSendFile,
  perms,
  service,
  onSetPower,
  onToggleBlock,
  onIgnore,
  onMention,
  onModerate,
  onSetRole,
  onOpenDm,
  onWhisper,
  onSendFile,
  canCall,
  onCall,
  onProfile
}: MemberRowProps): JSX.Element {
  const { menu, open, close } = useContextMenu()

  // Moderation is only *offered* where the cached permissions say it would
  // work; the server is still the actual authority and re-checks regardless.
  const entries: MenuEntry[] = [
    // First, because it is what a right click on a person is usually for -
    // and because everything under it acts on somebody, which is a thing to
    // decide after seeing who they are rather than before.
    ...(onProfile ? ([{ label: 'Profile', icon: 'person_search', onClick: onProfile }] as MenuEntry[]) : []),
    { label: 'Mention', icon: 'alternate_email', onClick: onMention },
    ...(canCall ? ([{ label: 'Call', icon: 'call', onClick: onCall }] as MenuEntry[]) : []),
    ...(canOpenDm ? ([{ label: 'Open DM', icon: 'chat', onClick: onOpenDm }] as MenuEntry[]) : []),
    ...(canWhisper ? ([{ label: 'Whisper', icon: 'lock', onClick: onWhisper }] as MenuEntry[]) : []),
    ...(canSendFile ? ([{ label: 'Send a file', icon: 'upload_file', onClick: onSendFile }] as MenuEntry[]) : []),
    { separator: true },
    // Not hearing from them. This used to be a list in this window's own
    // preferences, which hid the lines and nothing else: they still counted
    // as unread, still notified, still went into the log. It goes to the
    // daemon now, which tells Matrix and Discord - both of which have a real
    // list of their own - and keeps one itself for the services that have
    // none. The window-local list stays only as the thing that hides what is
    // already on screen.
    {
      label: blocked ? `Stop ignoring ${member.nick}` : `Ignore ${member.nick}`,
      icon: blocked ? 'check_circle' : 'block',
      danger: !blocked,
      onClick: () => {
        onToggleBlock(blockKey)
        onIgnore(!blocked)
      }
    },
    ...(perms.canMute
      ? ([{ label: 'Mute', icon: 'volume_off', onClick: () => onModerate('mute') }] as MenuEntry[])
      : []),
    ...(perms.canKick
      ? ([
          {
            // Named for what it does on this service. There is nobody to
            // remove from a livestream chat, so on Kick it is a timeout.
            label: service === 'kick' ? 'Time out for 10 minutes' : 'Kick',
            icon: 'logout',
            danger: true,
            onClick: () => onModerate('kick')
          }
        ] as MenuEntry[])
      : []),
    ...(perms.canBan
      ? ([{ label: 'Ban', icon: 'gavel', danger: true, onClick: () => onModerate('ban') }] as MenuEntry[])
      : []),
    // Matrix ranks are a number rather than a flag, so they are offered as
    // the three the protocol's own defaults are built around: 0 is everybody,
    // 50 is what "moderator" means to every other client, 100 is the room's
    // owner. Only where this account may change them at all.
    ...(service === 'matrix' && perms.canMute
      ? ([
          { separator: true },
          { label: 'Make moderator', icon: 'shield', onClick: () => onSetPower(50) },
          { label: 'Make admin', icon: 'star', onClick: () => onSetPower(100) },
          { label: 'Reset to default', icon: 'person', onClick: () => onSetPower(0) }
        ] as MenuEntry[])
      : []),
    // Channel ranks, which only IRC has. Both directions offered rather than
    // one toggle: the member's own prefix says which way round it should be,
    // and a menu that guessed wrong would take op from somebody by accident.
    // Discord's roles, offered as entries rather than a submenu: a guild has
    // a handful worth giving by hand, and the rest are managed by bots and
    // were filtered out before they got here.
    ...(service === 'discord' && perms.canAssignRoles && (perms.roles?.length ?? 0) > 0
      ? ([
          { separator: true },
          ...(perms.roles ?? []).slice(0, 12).map((role) => ({
            label: `Give ${role.name}`,
            icon: 'shield',
            onClick: () => onSetRole(role.id, true)
          })),
          ...(member.roles ?? [])
            .filter((held) => (perms.roles ?? []).some((r) => r.name === held))
            .map((held) => ({
              label: `Take ${held}`,
              icon: 'remove_moderator',
              onClick: () => {
                const role = (perms.roles ?? []).find((r) => r.name === held)
                if (role) onSetRole(role.id, false)
              }
            }))
        ] as MenuEntry[])
      : []),
    ...(perms.canOp
      ? ([
          { separator: true },
          { label: member.prefix?.includes('@') ? 'Take operator' : 'Give operator', icon: 'shield', onClick: () => onModerate(member.prefix?.includes('@') ? 'deop' : 'op') },
          { label: member.prefix?.includes('+') ? 'Take voice' : 'Give voice', icon: 'campaign', onClick: () => onModerate(member.prefix?.includes('+') ? 'mute' : 'voice') }
        ] as MenuEntry[])
      : [])
  ]

  return (
    <>
      <button
        type="button"
        className={classes('nick-row', member.away && 'away', blocked && 'blocked')}
        onContextMenu={open}
        onClick={onMention}
        title={memberTitle(member)}
      >
        {/* IRC's rank is one character and sits in a fixed slot before the
            name. Kick's is a word - "moderator", "subscriber" - which
            overflowed that eight-pixel slot and painted straight over the
            nick beside it. A word is drawn as a badge instead, after the
            name, the same way it is drawn in a message. */}
        {member.prefix && member.prefix.length === 1 && (
          <span className="nick-prefix">{member.prefix}</span>
        )}
        <span className="ellipsis" style={{ color: nickColor(member.nick) }}>
          {member.nick}
        </span>
        {member.prefix && member.prefix.length > 1 && (
          <span className={`sender-badge small ${member.prefix}`} title={member.prefix}>
            {shortBadge(member.prefix)}
          </span>
        )}
        {/* The network's own word for it, not a guess from the name. Drawn
            after the nick like any other badge, and only where the network
            actually said so. */}
        {member.bot && (
          <span className="sender-badge small bot" title="The network says this one is a program">
            BOT
          </span>
        )}
        {blocked && <Icon name="block" size={12} />}
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={entries} onClose={close} />}
    </>
  )
}
