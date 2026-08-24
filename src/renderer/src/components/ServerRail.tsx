import { useRef, useState } from 'react'
import { ContextMenu, useContextMenu } from './ContextMenu'
import { Icon, MaskIcon } from './Icon'
import { useChat, useIdSetPref, usePref, useStore } from '../state/hooks'
import { classes, nickColor, resolveMediaUrl, serviceIcon } from '../lib/util'
import {
  isFixedEntry,
  orderedGroups,
  railEntries,
  fileInFolder,
  removeFromFolders,
  type RailFolder,
  PINNED_GROUP_ID,
  pinnedGroup,
  reorder,
  visibleGroups,
  countsTowardRail,
  dmGroup,
  DM_GROUP_ID,
  isDirectMessage,
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
  /** A picture the user chose, which outranks whatever the service supplies. */
  customIcon?: string
  active: boolean
  unread: number
  highlight: boolean
  draggable: boolean
  /** Shown nested under an open folder, and indented to say so. */
  inFolder?: boolean
  dropTarget: boolean
  muted: boolean
  onToggleMute: () => void
  onSelect: () => void
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
}

/**
 * What a rail entry looks like, without the tile around it.
 *
 * Shared so a folder can show the faces of what it holds: the same precedence
 * has to apply there, or a server would be recognisable in the column and
 * unrecognisable inside a folder.
 *
 * That precedence is deliberate: a real icon, else the mark for an entry that
 * stands for a whole account, else initials. A guild is a name first - showing
 * every icon-less guild the same Discord logo would make them
 * indistinguishable, which is the one thing the rail exists to avoid.
 */
function GroupFace({ group, customIcon }: { group: RailGroup; customIcon?: string }): JSX.Element {
  const service = serviceIcon(group.service)
  if (customIcon) return <img className="rail-icon" src={resolveMediaUrl(customIcon)} alt="" />
  if (group.kind === 'pinned') return <Icon name="push_pin" size={22} />
  if (group.iconUrl) return <img className="rail-icon" src={resolveMediaUrl(group.iconUrl)} alt="" />
  if (group.kind === 'dms') return <Icon name="forum" size={22} />
  if (group.kind === 'account' && service.mark && service.colour) {
    // Artwork with colour worth keeping, shown as-is rather than flattened to
    // a silhouette - it sits beside full-colour guild icons here, and this is
    // the one place with room for it.
    return <img className="rail-mark" src={service.mark} alt="" />
  }
  if (group.kind === 'account') {
    return service.mark ? <MaskIcon src={service.mark} size={22} /> : <Icon name={service.glyph!} size={22} />
  }
  return (
    <span className="rail-initials" style={{ color: nickColor(group.name) }}>
      {initials(group.name)}
    </span>
  )
}

function RailTile(props: TileProps): JSX.Element {
  const { group, active, unread, highlight, draggable, dropTarget, customIcon, muted, inFolder } = props
  const { menu, open, close } = useContextMenu()
  const service = serviceIcon(group.service)
  // Only a guild or space needs telling apart by service: its face is a
  // picture or initials that say nothing about where it came from. An account
  // tile already *is* the service mark, and the direct message and pinned
  // pages span every service at once, so a single mark on those would be a
  // lie rather than a label.
  const badge = group.kind === 'guild' || group.kind === 'space' ? service : null

  const content = <GroupFace group={group} customIcon={customIcon} />

  return (
    <button
      type="button"
      className={classes('rail-tile', active && 'active', dropTarget && 'drop-target', muted && 'muted', inFolder && 'in-folder')}
      title={group.name}
      aria-label={group.name}
      aria-current={active}
      draggable={draggable}
      onClick={props.onSelect}
      onContextMenu={open}
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
      {/* Which service this belongs to, rather than a count. The unread
          count lives on the channel rows; up here the pill already says
          something is waiting, and what a tile needs to answer at a glance
          is "whose server is this". Skipped where the face is already the
          service mark, and on the cross-service pinned page. */}
      {muted && (
        <span className="rail-muted" title="Muted">
          <Icon name="notifications_off" size={11} />
        </span>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={[
            {
              label: muted ? `Unmute ${group.name}` : `Mute ${group.name}`,
              icon: muted ? 'notifications_active' : 'notifications_off',
              onClick: props.onToggleMute
            }
          ]}
          onClose={close}
        />
      )}
      {badge && (
        <span className={`rail-service${highlight ? ' highlight' : ''}`}>
          {badge.colour && badge.mark ? (
            <img src={badge.mark} alt="" />
          ) : badge.mark ? (
            <MaskIcon src={badge.mark} size={11} color="var(--surface-text)" />
          ) : (
            <Icon name={badge.glyph!} size={11} />
          )}
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
  const [muted] = usePref<string[]>('mutedBuffers', [])
  const [hidden] = usePref<string[]>('hiddenBuffers', [])
  const [customIcons] = usePref<Record<string, string>>('groupIcons', {})
  const [mutedGroups, setMutedGroups] = usePref<string[]>('mutedGroups', [])
  const [folders, setFolders] = usePref<RailFolder[]>('railFolders', [])
  const [, toggleFolder, isFolderOpen] = useIdSetPref('openRailFolders')
  const [naming, setNaming] = useState<{ id: string; name: string } | null>(null)
  const { menu: railMenu, open: openRailMenu, close: closeRailMenu } = useContextMenu()
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; folder: RailFolder } | null>(null)

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
  const all = buffers as BufferEntry[]
  for (const b of all) {
    // Only what the pane below would show: a hidden buffer has no row to
    // reach, and a muted one is not asking for attention.
    if (!countsTowardRail(b, all, muted, hidden, mutedGroups)) continue
    // A buffer can count on more than one tile: where it lives, and on any
    // aggregate page that also lists it. Both are places the user would look.
    if (b.groupId) bump(b.groupId, b)
    if (isDirectMessage(b)) bump(DM_GROUP_ID, b)
    if (pinned.includes(b.id)) bump(PINNED_GROUP_ID, b)
  }

  const shown = visibleGroups(groups, all)
  const extras: RailGroup[] = []
  // Only worth a tile once there is something on it.
  if (all.some(isDirectMessage)) extras.push(dmGroup())
  if (pinned.length > 0) extras.push(pinnedGroup())
  const ordered = orderedGroups([...shown, ...extras], railOrder)

  if (ordered.length <= 1) return null

  const onDrop = (targetId: string): void => {
    const from = draggingRef.current
    if (from && from !== targetId) setRailOrder(reorder(ordered, from, targetId))
    endDrag()
  }

  // Dropping a server onto a folder files it there rather than reordering
  // the column, which is the whole gesture: folders are made by dragging
  // things into them.
  const onDropInFolder = (folderId: string): void => {
    const from = draggingRef.current
    if (from) setFolders(fileInFolder(folders, folderId, from))
    endDrag()
  }

  const newFolder = (): void => {
    const id = `folder-${Date.now().toString(36)}`
    setFolders([...folders, { id, name: 'New folder', members: [] }])
    if (!isFolderOpen(id)) toggleFolder(id)
    setNaming({ id, name: 'New folder' })
  }

  const entries = railEntries(ordered, folders, isFolderOpen)

  return (
    <nav className="server-rail" aria-label="Servers">
      {/* Only the entries scroll; the cog stays pinned to the foot. The
          empty space below them is a drop target and a menu: somewhere to
          drag a server out of a folder, and where folders are made. */}
      <div
        className="rail-scroll"
        onContextMenu={(e) => {
          // Only the space itself. A right-click that landed on a tile is
          // that tile's business.
          if (e.target !== e.currentTarget) return
          openRailMenu(e)
        }}
        onDragOver={(e) => e.target === e.currentTarget && e.preventDefault()}
        onDrop={(e) => {
          if (e.target !== e.currentTarget) return
          const from = draggingRef.current
          if (from) setFolders(removeFromFolders(folders, from))
          endDrag()
        }}
      >
      {entries.map((entry) => {
        if (entry.kind === 'folder') {
          const inside = entry.members.reduce(
            (acc, m) => {
              const t = totals.get(m.id)
              return { unread: acc.unread + (t?.unread ?? 0), highlight: acc.highlight || !!t?.highlight }
            },
            { unread: 0, highlight: false }
          )
          return (
            <FolderTile
              key={entry.id}
              folder={entry.folder}
              members={entry.members}
              open={isFolderOpen(entry.id)}
              unread={inside.unread}
              highlight={inside.highlight}
              customIcons={customIcons}
              dropTarget={over === entry.id && dragging !== ''}
              onToggle={() => toggleFolder(entry.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setFolderMenu({ x: e.clientX, y: e.clientY, folder: entry.folder })
              }}
              onDragOver={() => setOver(entry.id)}
              onDrop={() => onDropInFolder(entry.id)}
              onDragEnd={endDrag}
            />
          )
        }
        const g = entry.group
        const t = totals.get(g.id)
        return (
          <RailTile
            key={g.id}
            inFolder={folders.some((f) => f.members.includes(g.id))}
            group={g}
            customIcon={customIcons[g.id]}
            muted={mutedGroups.includes(g.id)}
            onToggleMute={() =>
              setMutedGroups(
                mutedGroups.includes(g.id)
                  ? mutedGroups.filter((x) => x !== g.id)
                  : [...mutedGroups, g.id]
              )
            }
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
      </div>

      {railMenu && (
        <ContextMenu
          x={railMenu.x}
          y={railMenu.y}
          entries={[{ label: 'New folder', icon: 'create_new_folder', onClick: newFolder }]}
          onClose={closeRailMenu}
        />
      )}

      {folderMenu && (
        <ContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          entries={[
            {
              label: 'Rename',
              icon: 'edit',
              onClick: () => setNaming({ id: folderMenu.folder.id, name: folderMenu.folder.name })
            },
            {
              label: 'Remove folder',
              icon: 'delete',
              danger: true,
              // The servers stay in the rail; only the folder goes.
              onClick: () => setFolders(folders.filter((f) => f.id !== folderMenu.folder.id))
            }
          ]}
          onClose={() => setFolderMenu(null)}
        />
      )}

      {naming && (
        <div className="rail-naming">
          <input
            autoFocus
            className="text-field"
            value={naming.name}
            onChange={(e) => setNaming({ ...naming, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setNaming(null)
              if (e.key === 'Enter') {
                const name = naming.name.trim()
                if (name) setFolders(folders.map((f) => (f.id === naming.id ? { ...f, name } : f)))
                setNaming(null)
              }
            }}
            onBlur={() => setNaming(null)}
          />
        </div>
      )}

      <div className="rail-divider" />
      <RailMenu />
    </nav>
  )
}

/**
 * A folder tile: several servers behind one square.
 *
 * Closed, it shows a grid of what is inside, which is how you recognise a
 * folder you made without opening it. Open, it becomes a plain marker and the
 * servers themselves are drawn underneath.
 */
function FolderTile(props: {
  folder: RailFolder
  members: RailGroup[]
  open: boolean
  unread: number
  highlight: boolean
  customIcons: Record<string, string>
  dropTarget: boolean
  onToggle: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
}): JSX.Element {
  const { folder, members, open, unread, highlight, customIcons, dropTarget } = props
  return (
    <button
      type="button"
      className={classes('rail-tile', 'rail-folder', open && 'open', dropTarget && 'drop-target')}
      title={`${folder.name} — ${members.length} ${members.length === 1 ? 'server' : 'servers'}`}
      aria-label={folder.name}
      onClick={props.onToggle}
      onContextMenu={props.onContextMenu}
      onDragOver={(e) => {
        e.preventDefault()
        props.onDragOver()
      }}
      onDrop={(e) => {
        e.preventDefault()
        props.onDrop()
      }}
      onDragEnd={props.onDragEnd}
    >
      <span className="rail-face folder-face">
        {open ? (
          <Icon name="folder_open" size={20} />
        ) : members.length === 0 ? (
          <Icon name="folder" size={20} />
        ) : (
          // Up to four, which is as many as read at this size.
          members.slice(0, 4).map((m) => (
            <span key={m.id} className="folder-chip">
              <GroupFace group={m} customIcon={customIcons[m.id]} />
            </span>
          ))
        )}
      </span>
      {/* Unread rolls up from inside: a folder that hides a busy server must
          not also hide that it is busy. */}
      {unread > 0 && (
        <span className={classes('rail-badge', highlight && 'highlight')}>
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  )
}

/**
 * The cog at the foot of the rail: the way into Accounts and Settings, which
 * used to sit in the channel list's own footer. They belong here because they
 * are about the app rather than about whichever server is selected.
 */
function RailMenu(): JSX.Element {
  const store = useStore()
  const { menu, open, close } = useContextMenu()
  return (
    <>
      <button
        type="button"
        className="rail-tile rail-cog"
        title="Accounts and settings"
        aria-label="Accounts and settings"
        // Opened by left click, unlike the tiles above it - it is a menu
        // button, not a thing being acted upon.
        onClick={open}
      >
        <span className="rail-face">
          <Icon name="settings" size={20} />
        </span>
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={[
            { label: 'Accounts', icon: 'manage_accounts', onClick: () => store.setActivePanel('accounts') },
            { label: 'Settings', icon: 'settings', onClick: () => store.setActivePanel('settings') }
          ]}
          onClose={close}
        />
      )}
    </>
  )
}
