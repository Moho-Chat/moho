import { useMemo, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { ContextMenu, useContextMenu, type MenuEntry } from './ContextMenu'
import { useActiveBuffer, useChat, useIdSetPref, useStore } from '../state/hooks'
import { classes, nickColor } from '../lib/util'
import type { Member } from '../../../shared/wire'

/**
 * The member list for the active channel. Two grouping modes, both driven off
 * the same protocol-agnostic presenceChange shape:
 *
 * - "tier" (IRC): owner / moderator / regular by rank prefix, alphabetical
 *   within each.
 * - "presence" (Matrix): online / offline by away flag, sorted by power level
 *   descending then alphabetically.
 */
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
  const isMatrix = account?.service === 'matrix'
  const perms = (buffer && permissions[buffer.id]) || {}

  const groups = useMemo(() => {
    const filtered = query
      ? members.filter((m) => m.nick.toLowerCase().includes(query.toLowerCase()))
      : members

    if (isMatrix) {
      const byPower = (a: Member, b: Member): number =>
        (b.powerLevel ?? 0) - (a.powerLevel ?? 0) || a.nick.localeCompare(b.nick)
      return [
        { label: 'Online', members: filtered.filter((m) => !m.away).sort(byPower) },
        { label: 'Offline', members: filtered.filter((m) => m.away).sort(byPower) }
      ].filter((g) => g.members.length > 0)
    }

    const byName = (a: Member, b: Member): number => a.nick.localeCompare(b.nick)
    const rank = (m: Member): number => '~&@%+'.indexOf(m.prefix || '')
    return [
      { label: 'Owners', members: filtered.filter((m) => rank(m) === 0).sort(byName) },
      { label: 'Moderators', members: filtered.filter((m) => rank(m) > 0 && rank(m) < 4).sort(byName) },
      { label: 'Members', members: filtered.filter((m) => rank(m) === -1 || rank(m) === 4).sort(byName) }
    ].filter((g) => g.members.length > 0)
  }, [members, isMatrix, query])

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
          <span className="small muted ellipsis">{members.length} members</span>
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
                isMatrix={isMatrix}
                perms={perms}
                onToggleBlock={toggleBlocked}
                onMention={() => store.startReply('', member.nick, '')}
                onModerate={(action) => {
                  if (!buffer || !account) return
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
                onOpenDm={() => {
                  if (!account) return
                  void window.moho
                    .rpc<{ bufferId: string }>('openMatrixDm', {
                      accountId: account.id,
                      userId: member.userId || member.nick,
                      displayName: member.nick
                    })
                    .then((r) => store.selectBuffer(r.bufferId))
                    .catch((e: Error) => store.toast('error', e.message))
                }}
              />
            ))}
          </div>
        ))}
        {members.length === 0 && <div className="nicklist-empty small muted">No member list yet.</div>}
        {blocked.length > 0 && <div className="nicklist-group small muted">{blocked.length} blocked</div>}
      </div>
    </div>
  )
}

interface MemberRowProps {
  member: Member
  blockKey: string
  blocked: boolean
  isMatrix: boolean
  perms: { canKick?: boolean; canBan?: boolean; canMute?: boolean }
  onToggleBlock: (key: string) => void
  onMention: () => void
  onModerate: (action: 'kick' | 'ban' | 'mute') => void
  onOpenDm: () => void
}

function MemberRow({
  member,
  blockKey,
  blocked,
  isMatrix,
  perms,
  onToggleBlock,
  onMention,
  onModerate,
  onOpenDm
}: MemberRowProps): JSX.Element {
  const { menu, open, close } = useContextMenu()

  // Moderation is only *offered* where the cached permissions say it would
  // work; the server is still the actual authority and re-checks regardless.
  const entries: MenuEntry[] = [
    { label: 'Mention', icon: 'alternate_email', onClick: onMention },
    ...(isMatrix ? ([{ label: 'Open DM', icon: 'chat', onClick: onOpenDm }] as MenuEntry[]) : []),
    { separator: true },
    {
      label: blocked ? 'Unblock' : 'Block',
      icon: blocked ? 'check_circle' : 'block',
      onClick: () => onToggleBlock(blockKey)
    },
    ...(perms.canMute
      ? ([{ label: 'Mute', icon: 'volume_off', onClick: () => onModerate('mute') }] as MenuEntry[])
      : []),
    ...(perms.canKick
      ? ([{ label: 'Kick', icon: 'logout', danger: true, onClick: () => onModerate('kick') }] as MenuEntry[])
      : []),
    ...(perms.canBan
      ? ([{ label: 'Ban', icon: 'gavel', danger: true, onClick: () => onModerate('ban') }] as MenuEntry[])
      : [])
  ]

  return (
    <>
      <button
        type="button"
        className={classes('nick-row', member.away && 'away', blocked && 'blocked')}
        onContextMenu={open}
        onClick={onMention}
        title={member.userId || member.nick}
      >
        {member.prefix && <span className="nick-prefix">{member.prefix}</span>}
        <span className="ellipsis" style={{ color: nickColor(member.nick) }}>
          {member.nick}
        </span>
        {blocked && <Icon name="block" size={12} />}
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={entries} onClose={close} />}
    </>
  )
}
