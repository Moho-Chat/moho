import { useRef, useState } from 'react'
import { ContextMenu, useContextMenu } from './ContextMenu'
import { Icon, IconButton, MaskIcon } from './Icon'
import { Avatar } from './Avatar'
import { LeaveConfirm } from './LeaveConfirm'
import { ircNetworkFor } from '../lib/networks'
import { useChat, usePref, useStore } from '../state/hooks'
import { bufferDisplayName, classes, nickColor, resolveMediaUrl, serviceIcon } from '../lib/util'
import {
  isFixedEntry,
  orderedGroups,
  railEntries,
  fileInFolder,
  foldTogether,
  removeFromFolders,
  FOLDER_COLOURS,
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
  dropTarget: boolean
  /** Being dragged right now: it leaves a gap where it was. */
  lifted: boolean
  /** A drop here would fold the two together rather than reorder. */
  mergeTarget: boolean
  muted: boolean
  onToggleMute: () => void
  /** Absent where there is nothing to leave - an account's own entry. */
  onLeave?: () => void
  onSelect: () => void
  onDragStart: () => void
  onDragOver: (merge: boolean) => void
  onDrop: (merge: boolean) => void
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
  // draggable={false} throughout: a picture is draggable on its own by
  // default, so taking hold of a tile by its icon dragged the icon rather
  // than the tile - which is a different gesture with different data behind
  // it, and Chromium presents that data to the page as a file. The tile is
  // what moves; its face is not separately grabbable.
  if (customIcon) return <img className="rail-icon" src={resolveMediaUrl(customIcon)} alt="" draggable={false} />
  if (group.kind === 'pinned') return <Icon name="push_pin" size={22} />
  if (group.iconUrl) return <img className="rail-icon" src={resolveMediaUrl(group.iconUrl)} alt="" draggable={false} />
  if (group.kind === 'dms') return <Icon name="forum" size={22} />
  if (group.kind === 'account' && service.mark && service.colour) {
    // Artwork with colour worth keeping, shown as-is rather than flattened to
    // a silhouette - it sits beside full-colour guild icons here, and this is
    // the one place with room for it.
    return <img className="rail-mark" src={service.mark} alt="" draggable={false} />
  }
  if (group.kind === 'account') {
    // A known IRC network gets its own colour and letters rather than the
    // same generic "#" every network would otherwise share - which is the
    // one thing the rail exists to avoid. Initials rather than logos: those
    // belong to the networks that own them, and a wrong-looking copy of
    // somebody's logo is worse than two clean letters. Anyone who wants the
    // real one can import it; a custom icon is handled above and outranks
    // this.
    //
    // The colour fills the tile and the letters are white, rather than the
    // letters carrying the colour on the ordinary tile background. Two thin
    // glyphs in a mid tone read as almost nothing at this size - Libera
    // managed 1.7:1 against an active tile - where a filled tile is legible
    // at a glance, which is the whole job of a rail.
    const network = group.service === 'irc' ? ircNetworkFor(group.name) : null
    if (network) {
      return (
        <span className="rail-initials rail-initials-filled" style={{ background: network.colour }}>
          {network.mark}
        </span>
      )
    }
    return service.mark ? <MaskIcon src={service.mark} size={22} /> : <Icon name={service.glyph!} size={22} />
  }
  return (
    <span className="rail-initials" style={{ color: nickColor(group.name) }}>
      {initials(group.name)}
    </span>
  )
}

/**
 * Whether a drop on this tile means "fold these together" or "put it here".
 *
 * The middle of the tile merges, the top and bottom thirds reorder - the same
 * split Discord uses, and the reason dragging onto an icon can create a folder
 * without taking away the ability to rearrange the column.
 */
function isMerge(e: React.DragEvent): boolean {
  const r = e.currentTarget.getBoundingClientRect()
  const y = (e.clientY - r.top) / r.height
  return y > 0.33 && y < 0.67
}

function RailTile(props: TileProps): JSX.Element {
  const { group, active, unread, highlight, draggable, dropTarget, customIcon, muted, lifted, mergeTarget } = props
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
      className={classes(
        'rail-tile',
        active && 'active',
        dropTarget && 'drop-target',
        mergeTarget && 'merge-target',
        lifted && 'lifted',
        muted && 'muted'
      )}
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
        props.onDragOver(isMerge(e))
      }}
      onDrop={(e) => {
        e.preventDefault()
        props.onDrop(isMerge(e))
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
            },
            // Only where there is something to leave. An account's own entry
            // stands for the connection itself, which is disconnected from
            // the accounts pane rather than left.
            ...(props.onLeave
              ? [
                  { separator: true } as const,
                  {
                    label: group.kind === 'space' ? 'Leave space' : 'Leave server',
                    icon: 'logout',
                    danger: true,
                    onClick: props.onLeave
                  } as const
                ]
              : [])
          ]}
          onClose={close}
        />
      )}
      {badge && (
        <span className={`rail-service${highlight ? ' highlight' : ''}`}>
          {badge.colour && badge.mark ? (
            <img src={badge.mark} alt="" draggable={false} />
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

/**
 * A conversation waiting to be read, as its own tile in the column.
 *
 * Discord's arrangement, and it earns its place: the direct messages page
 * gathers every conversation at once, so its tile can only ever say "something
 * is waiting in there somewhere". Lifting the unread ones out says who, which
 * is the part worth crossing the room for. They leave again once read, so this
 * stays a list of things outstanding rather than a second list of people.
 */
function DmTile(props: { buffer: BufferEntry; active: boolean; onSelect: () => void }): JSX.Element {
  const { buffer, active, onSelect } = props
  const name = bufferDisplayName(buffer.name)
  const count = buffer.unread
  return (
    <button
      type="button"
      className={classes('rail-tile', 'rail-dm', active && 'active')}
      title={`${name} - ${count} unread message${count === 1 ? '' : 's'}`}
      aria-label={`${name}, ${count} unread`}
      onClick={onSelect}
    >
      <span className={`rail-pill${active ? ' active' : ' unread'}`} />
      <span className="rail-face">
        <Avatar name={name} url={buffer.avatarUrl} size={40} />
      </span>
      {/* A count rather than a dot: one message from someone and thirty of
          them are different situations, and this column is where that gets
          decided. */}
      <span className={classes('rail-count', buffer.highlight && 'highlight')}>
        {count > 99 ? '99+' : count}
      </span>
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
  const activeBufferId = useChat((s) => s.activeBufferId)
  const buffers = useChat((s) => s.buffers)
  const [railOrder, setRailOrder] = usePref<string[]>('ui.railOrder', [])
  const [pinned] = usePref<string[]>('pinnedBuffers', [])
  const [muted] = usePref<string[]>('mutedBuffers', [])
  const [hidden] = usePref<string[]>('hiddenBuffers', [])
  const [customIcons] = usePref<Record<string, string>>('groupIcons', {})
  const [mutedGroups, setMutedGroups] = usePref<string[]>('mutedGroups', [])
  const [folders, setFolders] = usePref<RailFolder[]>('railFolders', [])
  // Which folder is showing its contents, if any. Deliberately not
  // remembered: a folder is a place to put things, and it looks the same
  // either way - there is no state here worth carrying across a restart.
  const [expanded, setExpanded] = useState('')
  const isFolderOpen = (id: string): boolean => expanded === id
  const toggleFolder = (id: string): void => setExpanded(expanded === id ? '' : id)
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; folder: RailFolder } | null>(null)
  const [settings, setSettings] = useState<RailFolder | null>(null)

  /** Every buffer belonging to any server in this folder. */
  const buffersInFolder = (folder: RailFolder): string[] =>
    (buffers as BufferEntry[]).filter((b) => b.groupId && folder.members.includes(b.groupId)).map((b) => b.id)

  // The authoritative dragged id lives in a ref, not in state: dragstart and
  // drop are separate events, and reading it from state means depending on a
  // re-render having happened in between. It usually has - a real drag spans
  // many frames - but the value is not the renderer's to lose. State mirrors
  // it purely so the tiles restyle while dragging.
  const draggingRef = useRef('')
  const [dragging, setDragging] = useState('')
  const [over, setOver] = useState('')
  // The tile a drop would merge into, as opposed to land beside.
  const [merging, setMerging] = useState('')
  /** The rail entry a leave has been asked about, pending confirmation. */
  const [leaving, setLeaving] = useState<RailGroup | null>(null)

  const beginDrag = (id: string): void => {
    draggingRef.current = id
    setDragging(id)
  }
  const endDrag = (): void => {
    draggingRef.current = ''
    setDragging('')
    setOver('')
    setMerging('')
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
    if (!countsTowardRail(b, muted, hidden, mutedGroups)) continue
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
  // No tile for mentions. It is not a place you keep - it is reached from the
  // inbox in the header, which is where the unread count already is, and a
  // permanent tile for it only competed with the servers this column is for.
  if (pinned.length > 0) extras.push(pinnedGroup())
  const ordered = orderedGroups([...shown, ...extras], railOrder)

  // The rail always draws, even with nothing in it.
  //
  // It used to hide itself below two entries, on the grounds that a column
  // holding one tile is a column with nothing to navigate between. That
  // reasoning missed what else lives here: the cog at the foot is the way to
  // Accounts and Settings, so hiding the rail on a fresh install removed the
  // only route to the screen where an account gets added - exactly when it is
  // the one thing the user needs.

  /**
   * Dropping one server onto another.
   *
   * Onto the middle of a tile makes a folder of the two, which is the gesture
   * people know from Discord. Near its top or bottom edge it still means
   * "put it here", so reordering does not disappear the moment folders exist.
   */
  const onDrop = (targetId: string, merge: boolean): void => {
    const from = draggingRef.current
    if (from && from !== targetId) {
      if (merge && !isFixedEntry(ordered.find((g) => g.id === targetId) ?? ordered[0])) {
        setFolders(foldTogether(folders, targetId, from))
      } else {
        setRailOrder(reorder(ordered, from, targetId))
      }
    }
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


  const entries = railEntries(ordered, folders)

  /**
   * Conversations with something waiting, most recent first.
   *
   * Unread ones only: opening one clears its count, which is exactly what
   * makes its tile go away once it has been dealt with. Muted and hidden
   * conversations are left out by the same rule the rest of the rail uses - a
   * muted conversation was told not to ask for attention, and a tile in this
   * column is asking.
   */
  const unreadDms = all
    .filter(
      (b) => isDirectMessage(b) && b.unread > 0 && countsTowardRail(b, muted, hidden, mutedGroups)
    )
    .sort((a, b) => (b.lastActivityTs || 0) - (a.lastActivityTs || 0))

  // The direct messages and pinned pages lead the column; waiting
  // conversations go directly beneath them and above the servers, which is
  // where Discord puts them and where the eye goes first.
  const leading = entries.filter((e) => e.kind === 'group' && isFixedEntry(e.group))
  const rest = entries.filter((e) => !(e.kind === 'group' && isFixedEntry(e.group)))

  const renderTile = (g: RailGroup): JSX.Element => {
    const t = totals.get(g.id)
    return (
      <RailTile
        key={g.id}
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
        onLeave={
          g.kind === 'guild' || g.kind === 'space' ? () => setLeaving(g) : undefined
        }
        unread={t?.unread ?? 0}
        highlight={t?.highlight ?? false}
        // Direct messages and pinned lead the rail by definition, so
        // there is nowhere for them to be dragged to.
        draggable={!isFixedEntry(g)}
        dropTarget={over === g.id && dragging !== '' && dragging !== g.id}
        lifted={dragging === g.id}
        mergeTarget={merging === g.id}
        onSelect={() => store.selectGroup(g.id)}
        onDragStart={() => beginDrag(g.id)}
        onDragOver={(wantsMerge) => {
          if (isFixedEntry(g)) return
          setOver(g.id)
          setMerging(wantsMerge && dragging !== g.id ? g.id : '')
        }}
        onDrop={(wantsMerge) => onDrop(g.id, wantsMerge)}
        onDragEnd={endDrag}
      />
    )
  }

  const renderEntry = (entry: (typeof entries)[number]): JSX.Element => {
        if (entry.kind === 'folder') {
          const open = isFolderOpen(entry.id)
          return (
            /* Expanded, the folder and its servers sit in one panel - the
               border and lighter ground are what say where the folder ends,
               now that its contents are no longer indented. */
            <div
              key={entry.id}
              className={classes('rail-folder-group', open && 'open')}
              // The chosen colour tints the panel and its border rather than
              // flooding it: these sit behind a grid of other people's icons,
              // which have to stay readable.
              style={
                open && entry.folder.colour
                  ? { background: `${entry.folder.colour}22`, borderColor: `${entry.folder.colour}66` }
                  : undefined
              }
            >
            <FolderTile
              key={entry.id}
              folder={entry.folder}
              members={entry.members}
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
            {open && entry.members.map((m) => renderTile(m))}
            </div>
          )
        }
        return renderTile(entry.group)
  }

  return (
    <nav className="server-rail" aria-label="Servers">
      {/* Only the entries scroll; the cog stays pinned to the foot. The empty
          space below them is where a server is dropped to take it back out of
          a folder - folders themselves are made by dropping one icon onto
          another. */}
      <div
        className="rail-scroll"
        onDragOver={(e) => e.target === e.currentTarget && e.preventDefault()}
        onDrop={(e) => {
          if (e.target !== e.currentTarget) return
          const from = draggingRef.current
          if (from) setFolders(removeFromFolders(folders, from))
          endDrag()
        }}
      >
      {leading.map(renderEntry)}

      {/* Conversations waiting to be read, between the pages that gather
          everything and the servers themselves. */}
      {unreadDms.length > 0 && (
        <>
          {unreadDms.map((b) => (
            <DmTile
              key={b.id}
              buffer={b}
              active={b.id === activeBufferId}
              // Opens it, and takes the rail to the direct messages page on
              // the way - that is where the conversation lives once read, and
              // this tile is about to disappear from under the cursor.
              onSelect={() => void store.selectBuffer(b.id, true)}
            />
          ))}
          <div className="rail-divider" />
        </>
      )}

      {rest.map(renderEntry)}
      </div>

      {folderMenu && (
        <ContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          entries={[
            {
              label: 'Mark Folder As Read',
              icon: 'mark_chat_read',
              onClick: () => void store.markBuffersRead(buffersInFolder(folderMenu.folder))
            },
            { label: 'Folder Settings', icon: 'settings', onClick: () => setSettings(folderMenu.folder) },
            // Closes them; it does not remove them. Removing is below, and
            // marked as the destructive thing it is.
            { label: 'Close All Folders', icon: 'folder', onClick: () => setExpanded('') },
            { separator: true },
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

      {settings && (
        <FolderSettings
          folder={settings}
          onSave={(name, colour) => {
            setFolders(folders.map((f) => (f.id === settings.id ? { ...f, name, colour } : f)))
            setSettings(null)
          }}
          onClose={() => setSettings(null)}
        />
      )}

      {leaving && (
        <LeaveConfirm
          name={leaving.name}
          detail={
            leaving.kind === 'space'
              ? 'You will leave every room in this space that you joined through it. Getting back in needs a fresh invite unless the space is public.'
              : "You won't be able to rejoin without a new invite, and its channels and history will go with it."
          }
          onCancel={() => setLeaving(null)}
          onLeave={() => {
            void store.leaveGroup(leaving.id)
            setLeaving(null)
          }}
        />
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
  customIcons: Record<string, string>
  dropTarget: boolean
  onToggle: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
}): JSX.Element {
  const { folder, members, customIcons, dropTarget } = props
  return (
    <button
      type="button"
      className={classes('rail-tile', 'rail-folder', dropTarget && 'drop-target')}
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
      {/* The same face whether or not it is showing its contents: a folder
          is a folder, and an icon that changes underfoot is one more thing to
          read. Empty it is just a folder; once there is something in it, the
          faces of what is inside - up to four, which is as many as read at
          this size. */}
      <span
        className="rail-face folder-face"
        // The chosen colour is on the tile itself, not only on the panel it
        // opens into. Closed is how a folder spends most of its life, and a
        // colour you picked to tell two folders apart is no use only once one
        // of them is open. Tinted rather than filled: four other people's
        // icons sit on top of it and have to stay readable.
        style={
          folder.colour
            ? { color: folder.colour, background: `${folder.colour}5c` }
            : undefined
        }
      >
        {members.length === 0 ? (
          <Icon name="folder" size={26} />
        ) : (
          members.slice(0, 4).map((m) => (
            <span key={m.id} className="folder-chip">
              <GroupFace group={m} customIcon={customIcons[m.id]} />
            </span>
          ))
        )}
      </span>
      {/* Once the face is a grid of other people's icons, nothing says it is
          a folder any more - so it takes the same corner badge a guild uses
          to name its service. An empty folder is already unmistakably one. */}
      {members.length > 0 && (
        <span className="rail-service">
          <Icon name="folder" size={11} />
        </span>
      )}
    </button>
  )
}

/**
 * Naming a folder and giving it a colour.
 *
 * A dialog rather than an inline field because there are two things to set and
 * one of them is a swatch grid, which does not fit in a 56px column.
 */
function FolderSettings({
  folder,
  onSave,
  onClose
}: {
  folder: RailFolder
  onSave: (name: string, colour?: string) => void
  onClose: () => void
}): JSX.Element {
  const [name, setName] = useState(folder.name)
  const [colour, setColour] = useState(folder.colour)

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal folder-settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Folder Settings</h2>
          <IconButton name="close" title="Close" onClick={onClose} />
        </div>

        <label className="folder-field">
          <span className="small muted">Folder Name</span>
          <input
            autoFocus
            className="text-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSave(name.trim() || folder.name, colour)}
          />
        </label>

        <div className="folder-field">
          <span className="small muted">Folder Colour</span>
          <div className="swatches">
            {/* No colour at all is a real choice - it is what every folder
                starts as, and the rail's own grey is not a worse answer than
                nine bright ones. */}
            <button
              type="button"
              className={classes('swatch', 'swatch-none', !colour && 'chosen')}
              title="No colour"
              onClick={() => setColour(undefined)}
            >
              <Icon name="block" size={14} />
            </button>
            {FOLDER_COLOURS.map((c) => (
              <button
                key={c.value}
                type="button"
                className={classes('swatch', colour === c.value && 'chosen')}
                style={{ background: c.value }}
                title={c.name}
                aria-label={c.name}
                onClick={() => setColour(c.value)}
              >
                {colour === c.value && <Icon name="check" size={14} />}
              </button>
            ))}
          </div>
        </div>

        <button type="button" className="button primary" onClick={() => onSave(name.trim() || folder.name, colour)}>
          Done
        </button>
      </div>
    </div>
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
