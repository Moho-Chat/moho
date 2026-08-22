import { useMemo } from 'react'
import { Icon, IconButton, MaskIcon } from './Icon'
import { ContextMenu, useContextMenu, type MenuEntry } from './ContextMenu'
import { useChat, useIdSetPref, useMapPref, usePref, useStore } from '../state/hooks'
import type { BufferEntry } from '../state/store'
import {
  bufferDisplayName,
  bufferKindGlyph,
  classes,
  guildOf,
  resolveMediaUrl,
  serviceIcon,
  serviceLabel
} from '../lib/util'
import type { Account } from '../../../shared/wire'

/**
 * Buffers grouped under a collapsible header per account, rather than one flat
 * list - "which service" is first-class everywhere else in this client, so the
 * sidebar reads that way too. Discord channels get a second level of grouping
 * per guild, because a single guild can easily carry 30+ text channels that
 * would otherwise flood every other account's rows.
 */
export function BufferList(): JSX.Element {
  const store = useStore()
  const buffers = useChat((s) => s.buffers)
  const accounts = useChat((s) => s.accounts)
  const activeBufferId = useChat((s) => s.activeBufferId)

  const [pinned, togglePin, isPinned] = useIdSetPref('pinnedBuffers')
  const [, toggleMute, isMuted] = useIdSetPref('mutedBuffers')
  const [hidden, , isHidden] = useIdSetPref('hiddenBuffers')
  const [, setHidden] = usePref<string[]>('hiddenBuffers', [])
  const [collapsedAccounts, setAccountCollapsed] = useMapPref<boolean>('collapsedAccounts')
  const [collapsedGuilds, setGuildCollapsed] = useMapPref<boolean>('collapsedGuilds')
  const [guildLimits, setGuildLimit] = useMapPref<number>('discordGuildChannelLimits')
  const [pinnedCollapsed, setPinnedCollapsed] = usePref<boolean>('pinnedCollapsed', false)

  const visible = useMemo(() => buffers.filter((b) => !hidden.includes(b.id)), [buffers, hidden])
  const pinnedBuffers = useMemo(
    () => visible.filter((b) => pinned.includes(b.id)),
    [visible, pinned]
  )

  const byAccount = useMemo(() => {
    const groups = new Map<string, BufferEntry[]>()
    for (const b of visible) {
      const list = groups.get(b.accountId)
      if (list) list.push(b)
      else groups.set(b.accountId, [b])
    }
    return groups
  }, [visible])

  /**
   * Muting a server buffer cascades to every channel and DM under that
   * account, matching how muting a whole IRC network is normally
   * all-or-nothing. The menu still toggles a buffer's *own* flag independently
   * of the cascade, the same way muting a channel inside an already-muted
   * Slack workspace works.
   */
  const isEffectivelyMuted = (buffer: BufferEntry): boolean => {
    if (isMuted(buffer.id)) return true
    if (buffer.kind === 'server') return false
    const server = buffers.find((b) => b.accountId === buffer.accountId && b.kind === 'server')
    return server ? isMuted(server.id) : false
  }

  const hideBuffer = (id: string): void => {
    if (!isHidden(id)) setHidden([...hidden, id])
  }

  return (
    <div className="bufferlist">
      <div className="bufferlist-scroll">
        {pinnedBuffers.length > 0 && (
          <>
            <GroupHeader
              label="Pinned"
              glyph="push_pin"
              collapsed={pinnedCollapsed}
              onToggle={() => setPinnedCollapsed(!pinnedCollapsed)}
            />
            {!pinnedCollapsed &&
              pinnedBuffers.map((b) => (
                <BufferRow
                  key={`pinned-${b.id}`}
                  buffer={b}
                  active={b.id === activeBufferId}
                  muted={isEffectivelyMuted(b)}
                  pinned
                  showServiceIcon
                  accounts={accounts}
                  onSelect={() => void store.selectBuffer(b.id)}
                  onTogglePin={() => togglePin(b.id)}
                  onToggleMute={() => toggleMute(b.id)}
                  onHide={() => hideBuffer(b.id)}
                  onClose={() => void store.closeBuffer(b.id)}
                />
              ))}
          </>
        )}

        {accounts.length === 0 && (
          <div className="bufferlist-empty muted small">
            No accounts yet. Add one to get started.
          </div>
        )}

        {accounts.map((account) => {
          const accountBuffers = byAccount.get(account.id) || []
          const collapsed = !!collapsedAccounts[account.id]
          const icon = serviceIcon(account.service)
          return (
            <div key={account.id} className="bufferlist-account">
              <div className="account-header">
                <button
                  type="button"
                  className="account-header-main"
                  onClick={() => setAccountCollapsed(account.id, !collapsed)}
                >
                  <Icon name={collapsed ? 'chevron_right' : 'expand_more'} size={16} />
                  {icon.svg ? <MaskIcon src={icon.svg} size={14} /> : <Icon name={icon.glyph!} size={14} />}
                  <span className="ellipsis">{account.displayName || account.id}</span>
                  <ConnectionDot state={account.state} />
                </button>
                <IconButton
                  name="add"
                  size={16}
                  title={`Join on ${serviceLabel(account.service)}`}
                  onClick={() => store.setActivePanel('join', account.id)}
                />
              </div>

              {!collapsed && (
                <AccountBuffers
                  account={account}
                  buffers={accountBuffers}
                  activeBufferId={activeBufferId}
                  accounts={accounts}
                  collapsedGuilds={collapsedGuilds}
                  guildLimits={guildLimits}
                  setGuildCollapsed={setGuildCollapsed}
                  setGuildLimit={setGuildLimit}
                  isEffectivelyMuted={isEffectivelyMuted}
                  isPinned={isPinned}
                  onSelect={(id) => void store.selectBuffer(id)}
                  onTogglePin={togglePin}
                  onToggleMute={toggleMute}
                  onHide={hideBuffer}
                  onClose={(id) => void store.closeBuffer(id)}
                />
              )}
            </div>
          )
        })}
      </div>

      <div className="divider-h" />
      <div className="bufferlist-footer">
        <button type="button" className="footer-button" onClick={() => store.setActivePanel('accounts')}>
          <Icon name="manage_accounts" size={16} />
          Accounts
        </button>
        <button type="button" className="footer-button" onClick={() => store.setActivePanel('settings')}>
          <Icon name="settings" size={16} />
          Settings
        </button>
      </div>
    </div>
  )
}

function ConnectionDot({ state }: { state: string }): JSX.Element {
  const color =
    state === 'connected'
      ? 'var(--success)'
      : state === 'connecting'
        ? 'var(--warning)'
        : 'var(--outline)'
  return <span className="connection-dot" style={{ background: color }} title={state} />
}

function GroupHeader({
  label,
  glyph,
  collapsed,
  onToggle,
  trailing
}: {
  label: string
  glyph?: string
  collapsed: boolean
  onToggle: () => void
  trailing?: JSX.Element
}): JSX.Element {
  return (
    <div className="group-header">
      <button type="button" className="group-header-main" onClick={onToggle}>
        <Icon name={collapsed ? 'chevron_right' : 'expand_more'} size={16} />
        {glyph && <Icon name={glyph} size={14} />}
        <span className="ellipsis">{label}</span>
      </button>
      {trailing}
    </div>
  )
}

interface AccountBuffersProps {
  account: Account
  buffers: BufferEntry[]
  activeBufferId: string
  accounts: Account[]
  collapsedGuilds: Record<string, boolean>
  guildLimits: Record<string, number>
  setGuildCollapsed: (key: string, value: boolean) => void
  setGuildLimit: (key: string, value: number) => void
  isEffectivelyMuted: (b: BufferEntry) => boolean
  isPinned: (id: string) => boolean
  onSelect: (id: string) => void
  onTogglePin: (id: string) => void
  onToggleMute: (id: string) => void
  onHide: (id: string) => void
  onClose: (id: string) => void
}

function AccountBuffers(props: AccountBuffersProps): JSX.Element {
  const { account, buffers } = props
  const isDiscord = account.service === 'discord'

  // Server buffer first, then everything else by most recent activity - the
  // sort nobilis's own lastActivityTs exists to make possible without the client
  // having to query history itself.
  const sorted = useMemo(() => {
    const copy = [...buffers]
    copy.sort((a, b) => {
      if (a.kind === 'server' !== (b.kind === 'server')) return a.kind === 'server' ? -1 : 1
      return (b.lastActivityTs || 0) - (a.lastActivityTs || 0)
    })
    return copy
  }, [buffers])

  if (!isDiscord) {
    return (
      <>
        {sorted.map((b) => (
          <BufferRow key={b.id} buffer={b} active={b.id === props.activeBufferId} {...rowHandlers(props, b)} />
        ))}
      </>
    )
  }

  // Discord: group guild channels under their guild, DMs under one pseudo-guild.
  const guilds = new Map<string, BufferEntry[]>()
  const loose: BufferEntry[] = []
  for (const b of sorted) {
    const guild = b.kind === 'dm' ? 'Direct Messages' : guildOf(b.name)
    if (!guild) {
      loose.push(b)
      continue
    }
    const list = guilds.get(guild)
    if (list) list.push(b)
    else guilds.set(guild, [b])
  }

  return (
    <>
      {loose.map((b) => (
        <BufferRow key={b.id} buffer={b} active={b.id === props.activeBufferId} {...rowHandlers(props, b)} />
      ))}
      {[...guilds.entries()].map(([guild, list]) => {
        // Keyed by "accountId|guildName" rather than a real guild id, since the
        // buffer name is all we have. A name collision within one account is
        // the accepted edge case.
        const key = `${account.id}|${guild}`
        const collapsed = !!props.collapsedGuilds[key]
        const limit = props.guildLimits[key] ?? 10
        const shown = limit === -1 ? list : list.slice(0, limit)
        const hiddenCount = list.length - shown.length
        return (
          <div key={key} className="guild-group">
            <GroupHeader
              label={guild}
              glyph={guild === 'Direct Messages' ? 'alternate_email' : 'forum'}
              collapsed={collapsed}
              onToggle={() => props.setGuildCollapsed(key, !collapsed)}
            />
            {!collapsed && (
              <>
                {shown.map((b) => (
                  <BufferRow
                    key={b.id}
                    buffer={b}
                    active={b.id === props.activeBufferId}
                    {...rowHandlers(props, b)}
                  />
                ))}
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    className="guild-more small muted"
                    onClick={() => props.setGuildLimit(key, -1)}
                  >
                    Show {hiddenCount} more
                  </button>
                )}
                {limit === -1 && list.length > 10 && (
                  <button
                    type="button"
                    className="guild-more small muted"
                    onClick={() => props.setGuildLimit(key, 10)}
                  >
                    Show fewer
                  </button>
                )}
              </>
            )}
          </div>
        )
      })}
    </>
  )
}

function rowHandlers(
  props: AccountBuffersProps,
  b: BufferEntry
): Omit<BufferRowProps, 'buffer' | 'active'> {
  return {
    muted: props.isEffectivelyMuted(b),
    pinned: props.isPinned(b.id),
    accounts: props.accounts,
    onSelect: () => props.onSelect(b.id),
    onTogglePin: () => props.onTogglePin(b.id),
    onToggleMute: () => props.onToggleMute(b.id),
    onHide: () => props.onHide(b.id),
    onClose: () => props.onClose(b.id)
  }
}

interface BufferRowProps {
  buffer: BufferEntry
  active: boolean
  muted: boolean
  pinned: boolean
  accounts: Account[]
  /** Pinned rows sit outside their account group, so they carry the service
   * mark instead of the buffer-kind glyph to show where they belong. */
  showServiceIcon?: boolean
  onSelect: () => void
  onTogglePin: () => void
  onToggleMute: () => void
  onHide: () => void
  onClose: () => void
}

function BufferRow({
  buffer,
  active,
  muted,
  pinned,
  accounts,
  showServiceIcon,
  onSelect,
  onTogglePin,
  onToggleMute,
  onHide,
  onClose
}: BufferRowProps): JSX.Element {
  const { menu, open, close } = useContextMenu()
  const account = accounts.find((a) => a.id === buffer.accountId)

  // Under an account header the row's own kind is what's worth showing (a
  // channel vs a DM vs the server buffer). A pinned row has no header above
  // it, so it shows the service instead - the Discord or Matrix mark, or the
  // "#" that IRC channels already use - rather than repeating the account
  // name as text in front of every entry.
  const service = serviceIcon(account?.service ?? '')
  const leading = showServiceIcon ? (
    service.svg ? (
      <MaskIcon src={service.svg} size={15} />
    ) : (
      <Icon name={service.glyph!} size={15} />
    )
  ) : buffer.avatarUrl ? (
    <img className="buffer-avatar" src={resolveMediaUrl(buffer.avatarUrl)} alt="" />
  ) : (
    <Icon name={bufferKindGlyph(buffer.kind)} size={15} />
  )

  const entries: MenuEntry[] = [
    { label: pinned ? 'Unpin' : 'Pin', icon: 'push_pin', onClick: onTogglePin },
    { label: muted ? 'Unmute' : 'Mute', icon: muted ? 'notifications' : 'notifications_off', onClick: onToggleMute },
    { separator: true },
    { label: 'Hide', icon: 'visibility_off', onClick: onHide },
    ...(buffer.kind === 'server'
      ? []
      : ([{ label: 'Close', icon: 'close', danger: true, onClick: onClose }] as MenuEntry[]))
  ]

  return (
    <>
      <button
        type="button"
        className={classes('buffer-row', active && 'active', buffer.highlight && 'highlight')}
        onClick={onSelect}
        onContextMenu={open}
        title={buffer.name}
      >
        {leading}
        <span className="ellipsis buffer-name">{bufferDisplayName(buffer.name)}</span>
        {muted && <Icon name="notifications_off" size={13} className="buffer-muted-icon" />}
        {buffer.unread > 0 && !muted && (
          <span className={classes('unread-badge', buffer.highlight && 'highlight')}>
            {buffer.unread > 99 ? '99+' : buffer.unread}
          </span>
        )}
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={entries} onClose={close} />}
    </>
  )
}
