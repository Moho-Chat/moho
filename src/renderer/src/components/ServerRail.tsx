import { useRef, useState } from 'react'
import { Icon, MaskIcon } from './Icon'
import { useChat, usePref, useStore } from '../state/hooks'
import { nickColor, resolveMediaUrl, serviceIcon } from '../lib/util'
import {
  isFixedEntry,
  orderedGroups,
  PINNED_GROUP_ID,
  pinnedGroup,
  reorder,
  visibleGroups,
  type RailGroup
} from '../lib/groups'
import type { BufferEntry } from '../state/store'

/**
 * The leftmost column: direct messages, pinned, then one tile per Discord
 * guild, Matrix space, or account for protocols with no grouping of their own.
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
  group: RailGroup
  active: boolean
  unread: number
  highlight: boolean
  draggable: boolean
  dropTarget: boolean
  onSelect: () => void
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
}

function RailTile(props: TileProps): JSX.Element {
  const { group, active, unread, highlight, draggable, dropTarget } = props
  const service = serviceIcon(group.service)

  // Precedence is deliberate: a real icon, else the mark for an entry that
  // stands for a whole account, else initials. A guild is a name first -
  // showing every icon-less guild the same Discord logo would make them
  // indistinguishable, which is the one thing the rail exists to avoid.
  let content: JSX.Element
  if (group.kind === 'pinned') {
    content = <Icon name="push_pin" size={22} />
  } else if (group.iconUrl) {
    content = <img className="rail-icon" src={resolveMediaUrl(group.iconUrl)} alt="" />
  } else if (group.kind === 'dms') {
    content = <Icon name="forum" size={22} />
  } else if (group.kind === 'account' && service.mark && service.colour) {
    // Artwork with colour worth keeping, shown as-is rather than flattened to
    // a silhouette - it sits beside full-colour guild icons here, and this is
    // the one place with room for it.
    content = <img className="rail-mark" src={service.mark} alt="" />
  } else if (group.kind === 'account') {
    content = service.mark ? <MaskIcon src={service.mark} size={22} /> : <Icon name={service.glyph!} size={22} />
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
      className={`rail-tile${active ? ' active' : ''}${dropTarget ? ' drop-target' : ''}`}
      title={group.name}
      aria-label={group.name}
      aria-current={active}
      draggable={draggable}
      onClick={props.onSelect}
      onDragStart={(e) => {
        // Chromium abandons a drag whose dataTransfer was never written to.
        e.dataTransfer.setData('text/plain', group.id)
        e.dataTransfer.effectAllowed = 'move'
        props.onDragStart()
      }}
      onDragOver={(e) => {
        // Without preventDefault the browser refuses the drop outright.
        e.preventDefault()
        props.onDragOver()
      }}
      onDrop={(e) => {
        e.preventDefault()
        props.onDrop()
      }}
      onDragEnd={props.onDragEnd}
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
  const [railOrder, setRailOrder] = usePref<string[]>('ui.railOrder', [])
  const [pinned] = usePref<string[]>('pinnedBuffers', [])

  // The authoritative dragged id lives in a ref, not in state: dragstart and
  // drop are separate events, and reading it from state means depending on a
  // re-render having happened in between. It usually has - a real drag spans
  // many frames - but the value is not the renderer's to lose. State mirrors
  // it purely so the tiles restyle while dragging.
  const draggingRef = useRef('')
  const [dragging, setDragging] = useState('')
  const [over, setOver] = useState('')

  const beginDrag = (id: string): void => {
    draggingRef.current = id
    setDragging(id)
  }
  const endDrag = (): void => {
    draggingRef.current = ''
    setDragging('')
    setOver('')
  }

  // Unread rolls up from the buffers under each entry, so a guild whose
  // channels are all collapsed away still shows it has something waiting.
  const totals = new Map<string, { unread: number; highlight: boolean }>()
  const bump = (key: string, b: BufferEntry): void => {
    const t = totals.get(key) || { unread: 0, highlight: false }
    t.unread += b.unread
    t.highlight = t.highlight || b.highlight
    totals.set(key, t)
  }
  for (const b of buffers as BufferEntry[]) {
    if (b.groupId) bump(b.groupId, b)
    // A pinned buffer counts twice over - once where it lives, once on the
    // pinned page - because both tiles are places the user would look for it.
    if (pinned.includes(b.id)) bump(PINNED_GROUP_ID, b)
  }

  const shown = visibleGroups(groups, buffers as BufferEntry[])
  const withPinned = pinned.length > 0 ? [...shown, pinnedGroup()] : shown
  const ordered = orderedGroups(withPinned, railOrder)

  if (ordered.length <= 1) return null

  const onDrop = (targetId: string): void => {
    const from = draggingRef.current
    if (from && from !== targetId) setRailOrder(reorder(ordered, from, targetId))
    endDrag()
  }

  return (
    <nav className="server-rail" aria-label="Servers">
      {ordered.map((g) => {
        const t = totals.get(g.id)
        return (
          <RailTile
            key={g.id}
            group={g}
            active={g.id === activeGroupId}
            unread={t?.unread ?? 0}
            highlight={t?.highlight ?? false}
            // Direct messages and pinned lead the rail by definition, so
            // there is nowhere for them to be dragged to.
            draggable={!isFixedEntry(g)}
            dropTarget={over === g.id && dragging !== '' && dragging !== g.id}
            onSelect={() => store.selectGroup(g.id)}
            onDragStart={() => beginDrag(g.id)}
            onDragOver={() => !isFixedEntry(g) && setOver(g.id)}
            onDrop={() => onDrop(g.id)}
            onDragEnd={endDrag}
          />
        )
      })}
    </nav>
  )
}
