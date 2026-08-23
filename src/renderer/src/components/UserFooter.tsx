import { ContextMenu, useContextMenu } from './ContextMenu'
import { Icon, MaskIcon } from './Icon'
import { useStore } from '../state/hooks'
import { nickColor, resolveMediaUrl, serviceIcon } from '../lib/util'
import type { Account } from '../../../shared/wire'

/**
 * Who you are on the account you are currently looking at, at the foot of the
 * channel list - and the way to change how you are presenting.
 *
 * Per account rather than global because that is what the underlying status
 * is: each protocol carries its own.
 */

export type Status = 'online' | 'idle'

const STATUSES: { id: Status; label: string; glyph: string }[] = [
  { id: 'online', label: 'Online', glyph: 'circle' },
  { id: 'idle', label: 'Idle', glyph: 'dark_mode' }
]

export function statusColor(status: string): string {
  return status === 'idle' ? 'var(--warning)' : 'var(--success)'
}

export function UserFooter({ account }: { account?: Account }): JSX.Element {
  const store = useStore()
  const { menu, open, close } = useContextMenu()

  // With no account selected there is nobody to show, but the footer still
  // has to exist so the layout doesn't jump when one arrives.
  if (!account) return <div className="user-footer empty" />

  const status = (account.status || 'online') as Status
  const service = serviceIcon(account.service)
  const name = account.displayName || account.id

  const setStatus = (next: Status): void => void store.setAccountStatus(account.id, next)

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
