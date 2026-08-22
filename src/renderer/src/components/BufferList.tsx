import { useMemo } from 'react'
import { Icon, IconButton, MaskIcon } from './Icon'
import { ContextMenu, useContextMenu, type MenuEntry } from './ContextMenu'
import { useChat, useIdSetPref, usePref, useStore } from '../state/hooks'
import { visibleGroups } from '../lib/groups'
import type { BufferEntry } from '../state/store'
import {
  bufferDisplayName,
  bufferKindGlyph,
  classes,
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
  const groups = useChat((s) => s.groups)
  const activeGroupId = useChat((s) => s.activeGroupId)

  const [pinned, togglePin, isPinned] = useIdSetPref('pinnedBuffers')
  const [, toggleMute, isMuted] = useIdSetPref('mutedBuffers')
  const [hidden, , isHidden] = useIdSetPref('hiddenBuffers')
  const [, setHidden] = usePref<string[]>('hiddenBuffers', [])
  const [pinnedCollapsed, setPinnedCollapsed] = usePref<boolean>('pinnedCollapsed', false)

  const visible = useMemo(() => buffers.filter((b) => !hidden.includes(b.id)), [buffers, hidden])

  // A stale selection (a guild that went away, a first run) resolves to the
  // first entry rather than an empty pane.
  const shownGroups = useMemo(() => visibleGroups(groups, visible), [groups, visible])
  const activeGroup = shownGroups.find((g) => g.id === activeGroupId) || shownGroups[0]
  const groupAccount = accounts.find((a) => a.id === activeGroup?.accountId)

  // Server buffer first, then most recent activity - the ordering nobilis's
  // lastActivityTs exists to make possible without querying history here.
  const groupBuffers = useMemo(() => {
    if (!activeGroup) return []
    return visible
      .filter((b) => b.groupId === activeGroup.id)
      .sort((a, b) => {
        if ((a.kind === 'server') !== (b.kind === 'server')) return a.kind === 'server' ? -1 : 1
        return (b.lastActivityTs || 0) - (a.lastActivityTs || 0)
      })
  }, [visible, activeGroup])
  const pinnedBuffers = useMemo(
    () => visible.filter((b) => pinned.includes(b.id)),
    [visible, pinned]
  )

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

        {accounts.length > 0 && !activeGroup && (
          <div className="bufferlist-empty muted small">Select a server on the left.</div>
        )}

        {activeGroup && (
          <>
            <div className="group-title">
              <span className="ellipsis group-title-name">{activeGroup.name}</span>
              {groupAccount && <ConnectionDot state={groupAccount.state} />}
              {groupAccount && (
                <IconButton
                  name="add"
                  size={16}
                  title={`Join on ${serviceLabel(groupAccount.service)}`}
                  onClick={() => store.setActivePanel('join', groupAccount.id)}
                />
              )}
            </div>

            {groupBuffers.length === 0 && (
              <div className="bufferlist-empty muted small">Nothing here yet.</div>
            )}

            {groupBuffers.map((b) => (
              <BufferRow
                key={b.id}
                buffer={b}
                active={b.id === activeBufferId}
                muted={isEffectivelyMuted(b)}
                pinned={isPinned(b.id)}
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
    service.mark ? (
      <MaskIcon src={service.mark} size={15} />
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
