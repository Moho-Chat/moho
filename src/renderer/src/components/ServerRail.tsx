import { Icon, MaskIcon } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { nickColor, resolveMediaUrl, serviceIcon } from '../lib/util'
import type { BufferGroup } from '../../../shared/wire'
import type { BufferEntry } from '../state/store'

/**
 * The leftmost column: one tile per Discord guild, Matrix space, direct-message
 * collection, or account for protocols that have no grouping of their own.
 *
 * The grouping itself comes from nobilis (Buffer.groupId), not from parsing
 * buffer names here - which is what lets a protocol gain grouping later
 * without this component changing at all.
 */

/** Up to two characters, so a tile reads at 44px. Skips punctuation. */
function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

interface TileProps {
  group: BufferGroup
  active: boolean
  unread: number
  highlight: boolean
  onSelect: () => void
}

function RailTile({ group, active, unread, highlight, onSelect }: TileProps): JSX.Element {
  const service = serviceIcon(group.service)

  // Precedence is deliberate: a real icon, else the brand mark for an entry
  // that stands for a whole account, else initials. A guild is a name first -
  // showing every icon-less guild the same Discord logo would make them
  // indistinguishable, which is the one thing the rail exists to avoid.
  let content: JSX.Element
  if (group.iconUrl) {
    content = <img className="rail-icon" src={resolveMediaUrl(group.iconUrl)} alt="" />
  } else if (group.kind === 'dms') {
    content = <Icon name="forum" size={22} />
  } else if (group.kind === 'account') {
    content = service.svg ? <MaskIcon src={service.svg} size={22} /> : <Icon name={service.glyph!} size={22} />
  } else {
    content = (
      <span className="rail-initials" style={{ color: nickColor(group.name) }}>
        {initials(group.name)}
      </span>
    )
  }

  return (
    <button
      type="button"
      className={`rail-tile${active ? ' active' : ''}`}
      title={group.name}
      aria-label={group.name}
      aria-current={active}
      onClick={onSelect}
    >
      {/* Discord's pill: it grows on selection and on unread, so the rail
          reads at a glance without opening anything. */}
      <span className={`rail-pill${active ? ' active' : unread ? ' unread' : ''}`} />
      <span className="rail-face">{content}</span>
      {unread > 0 && !active && (
        <span className={`rail-badge${highlight ? ' highlight' : ''}`}>
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  )
}

export function ServerRail(): JSX.Element | null {
  const store = useStore()
  // One field per call, never a fresh object: useSyncExternalStore compares
  // the selector's result by identity, so returning a new object each render
  // reports a change every time and loops until React gives up.
  const groups = useChat((s) => s.groups)
  const activeGroupId = useChat((s) => s.activeGroupId)
  const buffers = useChat((s) => s.buffers)

  if (groups.length <= 1) return null

  // Unread rolls up from the buffers under each entry, so a guild whose
  // channels are all collapsed away still shows it has something waiting.
  const totals = new Map<string, { unread: number; highlight: boolean }>()
  for (const b of buffers as BufferEntry[]) {
    if (!b.groupId) continue
    const t = totals.get(b.groupId) || { unread: 0, highlight: false }
    t.unread += b.unread
    t.highlight = t.highlight || b.highlight
    totals.set(b.groupId, t)
  }

  return (
    <nav className="server-rail" aria-label="Servers">
      {groups.map((g) => {
        const t = totals.get(g.id)
        return (
          <RailTile
            key={g.id}
            group={g}
            active={g.id === activeGroupId}
            unread={t?.unread ?? 0}
            highlight={t?.highlight ?? false}
            onSelect={() => store.selectGroup(g.id)}
          />
        )
      })}
    </nav>
  )
}
