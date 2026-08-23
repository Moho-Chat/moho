import { ContextMenu, useContextMenu } from './ContextMenu'
import { Icon, MaskIcon } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { nickColor, resolveMediaUrl, serviceIcon } from '../lib/util'
import type { Account } from '../../../shared/wire'

/**
 * Who you are on the account you are currently looking at, at the foot of the
 * channel list - and the way to change how you are presenting.
 *
 * Per account rather than global because that is what the underlying status
 * is: each protocol carries its own, and only Do Not Disturb reaches across
 * all of them (by silencing notifications, which is this app's own doing
 * rather than anything a server is told).
 */

export type Status = 'online' | 'idle' | 'dnd'

const STATUSES: { id: Status; label: string; glyph: string; note?: string }[] = [
  { id: 'online', label: 'Online', glyph: 'circle' },
  { id: 'idle', label: 'Idle', glyph: 'dark_mode' },
  {
    id: 'dnd',
    label: 'Do Not Disturb',
    glyph: 'do_not_disturb_on',
    note: 'Silences notifications everywhere'
  }
]

export function statusColor(status: string): string {
  if (status === 'idle') return 'var(--warning)'
  if (status === 'dnd') return 'var(--error)'
  return 'var(--success)'
}

export function UserFooter({ account }: { account?: Account }): JSX.Element {
  const store = useStore()
  const accounts = useChat((s) => s.accounts)
  const { menu, open, close } = useContextMenu()

  // With no account selected there is nobody to show, but the footer still
  // has to exist so the layout doesn't jump when one arrives.
  if (!account) return <div className="user-footer empty" />

  const status = (account.status || 'online') as Status
  const service = serviceIcon(account.service)
  const name = account.displayName || account.id

  const setStatus = (next: Status): void => {
    // DND is a statement about the person, not the connection, so it goes to
    // every account at once. The others are per-account, matching where the
    // user set them from.
    const targets = next === 'dnd' || status === 'dnd' ? accounts : [account]
    for (const a of targets) void store.setAccountStatus(a.id, next)
  }

  return (
    <>
      <button type="button" className="user-footer" onClick={open} title={`${name} — ${STATUSES.find((s) => s.id === status)?.label}`}>
        <span className="user-avatar">
          {account.avatarUrl ? (
            <img src={resolveMediaUrl(account.avatarUrl)} alt="" />
          ) : service.mark ? (
            <MaskIcon src={service.mark} size={18} />
          ) : (
            <span className="avatar-fallback" style={{ background: nickColor(name) }}>
              {name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="user-status-dot" style={{ background: statusColor(status) }} />
        </span>
        <span className="user-identity">
          <span className="ellipsis user-name">{name}</span>
          <span className="ellipsis small muted">
            {STATUSES.find((s) => s.id === status)?.label}
          </span>
        </span>
        <Icon name="expand_less" size={16} />
      </button>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={STATUSES.map((s) => ({
            label: s.id === status ? `${s.label} ✓` : s.label,
            icon: s.glyph,
            onClick: () => setStatus(s.id)
          }))}
          onClose={close}
        />
      )}
    </>
  )
}
