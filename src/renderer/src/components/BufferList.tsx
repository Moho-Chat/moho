import { useMemo } from 'react'
import { Icon, IconButton, MaskIcon } from './Icon'
import { ContextMenu, useContextMenu, type MenuEntry } from './ContextMenu'
import { useChat, useIdSetPref, usePref, useStore } from '../state/hooks'
import { isMutedBuffer, PINNED_GROUP_ID, pinnedGroup, visibleGroups } from '../lib/groups'
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
  const [muted, toggleMute] = useIdSetPref('mutedBuffers')
  const [hidden, , isHidden] = useIdSetPref('hiddenBuffers')
  const [, setHidden] = usePref<string[]>('hiddenBuffers', [])

  const visible = useMemo(() => buffers.filter((b) => !hidden.includes(b.id)), [buffers, hidden])

  // A stale selection (a guild that went away, a first run) resolves to the
  // first entry rather than an empty pane. The pinned page is added the same
  // way the rail adds it, so both agree on what is selectable.
  const shownGroups = useMemo(() => {
    const list = visibleGroups(groups, visible)
    return pinned.length > 0 ? [...list, pinnedGroup()] : list
  }, [groups, visible, pinned])
  const activeGroup = shownGroups.find((g) => g.id === activeGroupId) || shownGroups[0]
  const isPinnedPage = activeGroup?.id === PINNED_GROUP_ID
  const groupAccount = accounts.find((a) => a.id === activeGroup?.accountId)

  /**
   * What the pane lists, in reading order: pinned first, then direct messages,
   * then channels, each band by most recent activity.
   *
   * The pinned page is the same list unfiltered by group - a pin is a
   * cross-service shortcut, so its page is the one place they all appear
   * together.
   */
  const groupBuffers = useMemo(() => {
    if (!activeGroup) return []
    const inScope = isPinnedPage
      ? visible.filter((b) => pinned.includes(b.id))
      : visible.filter((b) => b.groupId === activeGroup.id)

    // Server buffer above everything; then pinned, DMs, channels.
    const band = (b: BufferEntry): number => {
      if (b.kind === 'server') return 0
      if (!isPinnedPage && pinned.includes(b.id)) return 1
      if (b.kind === 'dm') return 2
      return 3
    }
    return [...inScope].sort(
      (a, b) => band(a) - band(b) || (b.lastActivityTs || 0) - (a.lastActivityTs || 0)
    )
  }, [visible, activeGroup, isPinnedPage, pinned])

  // The menu still toggles a buffer's *own* flag independently of the
  // cascade, the same way muting a channel inside an already-muted Slack
  // workspace works.
  const isEffectivelyMuted = (buffer: BufferEntry): boolean =>
    isMutedBuffer(buffer, buffers, muted)

  const hideBuffer = (id: string): void => {
    if (!isHidden(id)) setHidden([...hidden, id])
  }

  return (
    <div className="bufferlist">
      <div className="bufferlist-scroll">
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
