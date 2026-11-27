import { useMediaUrl } from '../lib/route'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ContextMenu, useContextMenu } from './ContextMenu'
import { railConnecting } from '../lib/bufferlink'
import { Icon, MaskIcon } from './Icon'
import { Modal } from './Modal'
import { Avatar } from './Avatar'
import { LeaveConfirm } from './LeaveConfirm'
import { ircNetworkFor } from '../lib/networks'
import { useChat, useInvitations, usePref, usePrefsReady, useStore } from '../state/hooks'
import { RAIL_TIP, hideRailTip, showRailTip, type RailTipDetail } from '../lib/railtip'
import { bufferDisplayName, classes, resolveMediaUrl, serviceIcon, spreadColor } from '../lib/util'
import { SpaceRooms } from './SpaceRooms'
import { SteamGroupSettings } from './SteamGroupSettings'
import { StoatServerSettings } from './StoatServerSettings'
import { steamGroupOfRail } from '../lib/steamchat'
import {
  disconnectedAccountIds,
  isFixedEntry,
  invitationsGroup,
  orderedGroups,
  railEntries,
  foldTogether,
  moveInRail,
  dissolveFolder,
  fileNewServers,
  withBadgeFolder,
  withSynced,
  badgesShown,
  normalizedFolders,
  ancestorsOf,
  parentOf,
  folderRef,
  folderIdOf,
  canDropOn,
  resolveGapDrop,
  FOLDER_COLOURS,
  type DropZone,
  type RailDropTarget,
  type RailSlot,
  type RailFolder,
  type RailEntry,
  type RailFolderEntry,
  type RailLayout,
  PINNED_GROUP_ID,
  pinnedGroup,
  visibleGroups,
  countedFor,
  isMutedBuffer,
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
  /** How many unread messages mention this account: the number the tile shows. */
  mentions: number
  draggable: boolean
  /** Where a drop here would land, while something is held over it. */
  dropAt: DropZone | null
  /** Being dragged right now: it leaves a gap where it was. */
  lifted: boolean
  muted: boolean
  onToggleMute: () => void
  /** Absent where there is nothing to leave - an account's own entry. */
  onLeave?: () => void
  /** Makes an invite link to the server and copies it. Stoat. */
  onInvite?: () => void
  /** Only a Matrix space has rooms to look through. */
  onBrowse?: () => void
  /** Only a Steam chat group keeps settings of its own: rooms, roles, invite links. */
  onSettings?: () => void
  onSelect: () => void
  onDragStart: () => void
  onDragOver: (zone: DropZone) => void
  onDrop: (zone: DropZone) => void
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
  const media = useMediaUrl(group.accountId)
  // draggable={false} throughout: a picture is draggable on its own by
  // default, so taking hold of a tile by its icon dragged the icon rather
  // than the tile - which is a different gesture with different data behind
  // it, and Chromium presents that data to the page as a file. The tile is
  // what moves; its face is not separately grabbable.
  if (customIcon) return <img className="rail-icon" src={resolveMediaUrl(customIcon)} alt="" draggable={false} />
  if (group.kind === 'pinned') return <Icon name="push_pin" size={22} />
  // An invitation reads as one rather than as an unfamiliar server: the room
  // usually has no picture and often no name, and initials taken off a raw
  // room id say nothing at all.
  if (group.kind === 'invitations') return <Icon name="mark_email_unread" size={22} />
  if (group.iconUrl) return <img className="rail-icon" src={media(group.iconUrl)} alt="" draggable={false} />
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
          {/* The network's own logo where it has one. On the network's own
              colour rather than on nothing: several of these are wordmarks
              with a transparent background, drawn for a white page. */}
          {network.logo ? (
            <img className="rail-network-logo" src={network.logo} alt="" />
          ) : (
            network.mark
          )}
        </span>
      )
    }
    return service.mark ? <MaskIcon src={service.mark} size={22} /> : <Icon name={service.glyph!} size={22} />
  }
  return (
    // Coloured by which tile it is, not by what it is called: three accounts with the same name had the same
    // two letters in the same colour, and nothing to tell them apart but their order (#339).
    <span className="rail-initials rail-initials-tinted" style={{ ['--tile' as string]: spreadColor(group.id) }}>
      {initials(group.name)}
    </span>
  )
}

/**
 * Whether a drop on this tile means "fold these together" or "put it here".
 *
 * The middle of the tile merges - or, on a folder, files it inside - and the
 * top and bottom thirds put it above or below: the same split Discord uses,
 * and the reason dragging onto an icon can create a folder without taking
 * away the ability to rearrange the column.
 */
function dropZone(e: React.DragEvent): DropZone {
  const r = e.currentTarget.getBoundingClientRect()
  const y = (e.clientY - r.top) / r.height
  return y <= 0.33 ? 'before' : y >= 0.67 ? 'after' : 'merge'
}

/** Collects the vertical bounds of direct movable entries inside a rail container. */
function collectSlots(container: Element, skipFirst = false): RailSlot[] {
  const slots: RailSlot[] = []
  const kids = Array.from(container.children)
  for (let i = skipFirst ? 1 : 0; i < kids.length; i++) {
    const el = kids[i]
    const tile = el.matches('[data-rail-ref]') ? el : el.querySelector(':scope > [data-rail-ref]')
    const ref = tile?.getAttribute('data-rail-ref')
    if (!ref) continue
    const r = el.getBoundingClientRect()
    slots.push({
      ref,
      top: r.top,
      bottom: r.bottom,
      openFolder: tile?.getAttribute('data-rail-open') === 'true'
    })
  }
  return slots
}

/**
 * Resolves a drag-over event that landed on the gap between tiles (either in
 * `.rail-scroll` or inside `.rail-folder-group.open`) or in the open space
 * below the column.
 */
function resolveRailContainerDrop(
  scrollEl: HTMLElement,
  target: EventTarget | null,
  clientY: number,
  dragging: string
): RailDropTarget {
  const openFolderEl = target instanceof Element ? target.closest('.rail-folder-group.open') : null
  if (openFolderEl && scrollEl.contains(openFolderEl)) {
    const header = openFolderEl.querySelector(':scope > [data-rail-ref]')
    const ref = header?.getAttribute('data-rail-ref')
    if (!ref || !header) return null
    const hr = header.getBoundingClientRect()
    return resolveGapDrop(collectSlots(openFolderEl, true), clientY, dragging, {
      folderRef: ref,
      headerTop: hr.top,
      headerBottom: hr.bottom
    })
  }
  return resolveGapDrop(collectSlots(scrollEl), clientY, dragging, { allowTail: true })
}

function sameDrop(a: RailDropTarget, b: RailDropTarget): boolean {
  if (a === b) return true
  if (!a || !b || a.kind !== b.kind) return false
  if (a.kind === 'tail' && b.kind === 'tail') return true
  return a.kind === 'tile' && b.kind === 'tile' && a.ref === b.ref && a.zone === b.zone
}

function RailTile(props: TileProps): JSX.Element {
  const { group, active, unread, highlight, mentions, draggable, dropAt, customIcon, muted, lifted } = props
  const { menu, open, close } = useContextMenu()
  const store = useStore()
  // What is waiting inside this server, for "Mark as read".
  const waiting = useChat((s) => s.buffers).filter((b) => b.groupId === group.id && (b.unread > 0 || b.highlight))
  const service = serviceIcon(group.service)
  // Only a guild or space needs telling apart by service: its face is a
  // picture or initials that say nothing about where it came from. An account
  // tile already *is* the service mark, and the direct message and pinned
  // pages span every service at once, so a single mark on those would be a
  // lie rather than a label.
  const badge = group.kind === 'guild' || group.kind === 'space' ? service : null

  const content = <GroupFace group={group} customIcon={customIcon} />
  // Not connected yet, or reconnecting: a spinner over the face until its
  // service has answered - see lib/bufferlink.
  const connecting = useChat((s) => railConnecting(group, s.buffers, s.accounts, s.connectionDetail))

  return (
    <button
      type="button"
      className={classes(
        'rail-tile',
        active && 'active',
        dropAt === 'merge' && 'merge-target',
        dropAt === 'before' && 'drop-before',
        dropAt === 'after' && 'drop-after',
        lifted && 'lifted',
        muted && 'muted',
        connecting && 'connecting'
      )}
      onMouseEnter={(e) => showRailTip(e.currentTarget, connecting ? `${group.name} — connecting…` : group.name)}
      onMouseLeave={hideRailTip}
      onFocus={(e) => showRailTip(e.currentTarget, group.name)}
      onBlur={hideRailTip}
      aria-label={group.name}
      aria-current={active}
      data-rail-ref={draggable ? group.id : undefined}
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
        if (!draggable) return
        // Without preventDefault the browser refuses the drop outright.
        e.preventDefault()
        e.stopPropagation()
        props.onDragOver(dropZone(e))
      }}
      onDrop={(e) => {
        if (!draggable) return
        e.preventDefault()
        e.stopPropagation()
        props.onDrop(dropZone(e))
      }}
      onDragEnd={props.onDragEnd}
    >
      {/* Discord's pill: it grows on selection and on unread, so the rail
          reads at a glance without opening anything. */}
      <span className={`rail-pill${active ? ' active' : unread ? ' unread' : ''}`} />
      <span className="rail-face">{content}</span>
      {connecting && (
        <span className="rail-connecting" aria-label="Connecting">
          <span className="spinner" />
        </span>
      )}
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
              label: 'Mark as read',
              icon: 'mark_chat_read',
              disabled: waiting.length === 0,
              onClick: () => void store.markBuffersRead(waiting.map((b) => b.id))
            },
            {
              label: muted ? `Unmute ${group.name}` : `Mute ${group.name}`,
              icon: muted ? 'notifications_active' : 'notifications_off',
              onClick: props.onToggleMute
            },
            // A space holds rooms this account has not joined, and sync
            // cannot see them - so this is the only way to find them.
            ...(props.onBrowse
              ? [
                  {
                    label: 'Browse rooms',
                    icon: 'workspaces',
                    onClick: props.onBrowse
                  } as const
                ]
              : []),
            ...(props.onInvite
              ? [
                  {
                    label: 'Copy invite link',
                    icon: 'link',
                    onClick: props.onInvite
                  } as const
                ]
              : []),
            ...(props.onSettings
              ? [
                  {
                    label: props.group.service === 'stoat' ? 'Server settings' : props.group.service === 'fluxer' ? 'Community settings' : 'Group settings',
                    icon: 'settings',
                    onClick: props.onSettings
                  } as const
                ]
              : []),
            // Only where there is something to leave. An account's own entry
            // stands for the connection itself, which is disconnected from
            // the accounts pane rather than left.
            ...(props.onLeave
              ? [
                  { separator: true } as const,
                  {
                    label: group.kind === 'space' ? 'Leave space' : group.service === 'telegram' ? 'Leave group' : group.service === 'fluxer' ? 'Leave community' : 'Leave server',
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
      {/* Mentions say how many are waiting, in the corner the service mark sits
          in - the mark gives way, since a count is what somebody scanning this
          column came to see. Only mentions: how many messages there are in a
          busy channel is not what this column is for, and the pill beside the
          tile already says there is something to read. */}
      {mentions > 0 && (
        <span className="rail-count highlight" title={`${mentions} mention${mentions === 1 ? '' : 's'}`}>
          {mentions > 99 ? '99+' : mentions}
        </span>
      )}
      {badge && mentions === 0 && (
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
      onMouseEnter={(e) => showRailTip(e.currentTarget, `${name} - ${count} unread message${count === 1 ? '' : 's'}`)}
      onMouseLeave={hideRailTip}
      aria-label={`${name}, ${count} unread`}
      onClick={onSelect}
    >
      <span className={`rail-pill${active ? ' active' : ' unread'}`} />
      <span className="rail-face">
        <Avatar name={name} url={buffer.avatarUrl} size={40} accountId={buffer.accountId} />
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
  const accounts = useChat((s) => s.accounts)
  const invitations = useInvitations()
  const activeGroupId = useChat((s) => s.activeGroupId)
  const activeBufferId = useChat((s) => s.activeBufferId)
  const buffers = useChat((s) => s.buffers)
  const disconnected = useMemo(() => disconnectedAccountIds(accounts), [accounts])
  const activeGroups = useMemo(() => groups.filter((g) => !disconnected.has(g.accountId)), [groups, disconnected])
  const activeBuffers = useMemo(
    () => (buffers as BufferEntry[]).filter((b) => !disconnected.has(b.accountId)),
    [buffers, disconnected]
  )
  const [railOrder, setRailOrder] = usePref<string[]>('ui.railOrder', [])
  const [pinned] = usePref<string[]>('pinnedBuffers', [])
  const [muted] = usePref<string[]>('mutedBuffers', [])
  const [hidden] = usePref<string[]>('hiddenBuffers', [])
  const [customIcons] = usePref<Record<string, string>>('groupIcons', {})
  const [mutedGroups, setMutedGroups] = usePref<string[]>('mutedGroups', [])
  const [folders, setFolders] = usePref<RailFolder[]>('railFolders', [])
  const fluxerFolders = useChat((s) => s.fluxerFolders)
  // What a service keeps for the account - Fluxer's guild_folders. Local folders the user made in moho always win
  // over these: they only get what nothing local has claimed.
  const synced = useMemo(
    () =>
      Object.entries(fluxerFolders)
        .filter(([accountId]) => !disconnected.has(accountId))
        .flatMap(([, list]) =>
          list.map((f): RailFolder => ({ id: f.id, name: f.name, colour: f.colour, members: f.members }))
        ),
    [fluxerFolders, disconnected]
  )
  const effectiveFolders = normalizedFolders(withSynced(folders, synced))
  // Which folder is showing its contents, if any - the innermost, when folders
  // are open inside each other, so the ones around it count as open too.
  // Remembered: a column that forgets which folders were open and shuts them
  // all on every start is one you re-arrange each morning.
  const [expanded, setExpanded] = usePref<string>('ui.railFolderOpen', '')
  const openPath = expanded ? [expanded, ...ancestorsOf(effectiveFolders, folderRef(expanded))] : []
  const isFolderOpen = (id: string): boolean => openPath.includes(id)
  // Shutting one shuts what is open inside it; opening one shuts its
  // neighbours but not the folders around it.
  const toggleFolder = (id: string): void =>
    setExpanded(isFolderOpen(id) ? (parentOf(effectiveFolders, folderRef(id))?.id ?? '') : id)
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; entry: RailFolderEntry } | null>(null)
  const [settings, setSettings] = useState<RailFolder | null>(null)

  /** Every buffer belonging to a badge or any server under a folder. */
  const buffersUnder = (entry: RailFolderEntry): string[] => {
    const ids = new Set([...(entry.head ? [entry.head.id] : []), ...entry.members.map((m) => m.id)])
    return (buffers as BufferEntry[]).filter((b) => b.groupId && ids.has(b.groupId)).map((b) => b.id)
  }

  // A server the account joins lands in its badge's folder rather than loose
  // at the foot of the column. Not before the preferences have loaded: with
  // the saved order still empty, every server would look new and be filed away.
  const prefsReady = usePrefsReady()
  useEffect(() => {
    if (!prefsReady) return
    const filed = fileNewServers(activeGroups, { order: railOrder, folders }, synced)
    if (filed) setFolders(filed)
  }, [prefsReady, activeGroups, railOrder, folders, synced, setFolders])

  // The authoritative dragged id lives in a ref, not in state: dragstart and
  // drop are separate events, and reading it from state means depending on a
  // re-render having happened in between. It usually has - a real drag spans
  // many frames - but the value is not the renderer's to lose. State mirrors
  // it purely so the tiles restyle while dragging.
  const draggingRef = useRef('')
  const [dragging, setDragging] = useState('')
  // Single authoritative drop target (both ref and state) so whatever the blue
  // marker shows is always the exact placement committed on drop.
  const activeDropRef = useRef<RailDropTarget>(null)
  const [activeDrop, setActiveDrop] = useState<RailDropTarget>(null)
  const setDrop = (next: RailDropTarget): void => {
    const valid = canDropOn(effectiveFolders, draggingRef.current, next) ? next : null
    activeDropRef.current = valid
    setActiveDrop((prev) => (sameDrop(prev, valid) ? prev : valid))
  }
  const dropAt = (ref: string): DropZone | null =>
    activeDrop?.kind === 'tile' && activeDrop.ref === ref && dragging !== '' && dragging !== ref
      ? activeDrop.zone
      : null
  const tailTarget = activeDrop?.kind === 'tail'
  /** The rail entry a leave has been asked about, pending confirmation. */
  const leaving = useChat((s) => s.leaveRequest)
  const setLeaving = (g: { id: string; name: string; kind: string } | null): void => store.requestLeave(g)
  /** The space whose contents are being looked through, if any. */
  const [browsing, setBrowsing] = useState<RailGroup | null>(null)
  /** The Steam chat group whose settings are open, if any. */
  const [configuring, setConfiguring] = useState<RailGroup | null>(null)
  const [stoatSettings, setStoatSettings] = useState<RailGroup | null>(null)

  const beginDrag = (id: string): void => {
    draggingRef.current = id
    setDragging(id)
  }
  const endDrag = (): void => {
    draggingRef.current = ''
    activeDropRef.current = null
    setDragging('')
    setActiveDrop(null)
  }

  // Unread rolls up from the buffers under each entry, so a guild whose
  // channels are all collapsed away still shows it has something waiting.
  const totals = new Map<string, { unread: number; highlight: boolean; mentions: number }>()
  // A direct message counts for every unread message in it - all of them are
  // for you - and anywhere else for its mentions (see countedFor).
  const bump = (key: string, b: BufferEntry): void => {
    const waiting = countedFor(b, muted, hidden, mutedGroups)
    // What a muted conversation says is only that your name was used in it:
    // its unread messages are not asking for anything.
    const quiet = isMutedBuffer(b, muted, mutedGroups)
    const t = totals.get(key) || { unread: 0, highlight: false, mentions: 0 }
    t.unread += quiet ? 0 : b.unread
    t.highlight = t.highlight || (quiet ? waiting > 0 : b.highlight)
    t.mentions += waiting
    totals.set(key, t)
  }
  const all = activeBuffers
  for (const b of all) {
    // A hidden buffer has no row to reach.
    if (hidden.includes(b.id)) continue
    // A buffer can count on more than one tile: where it lives, and on any
    // aggregate page that also lists it. Both are places the user would look.
    if (b.groupId) bump(b.groupId, b)
    if (isDirectMessage(b)) bump(DM_GROUP_ID, b)
    if (pinned.includes(b.id)) bump(PINNED_GROUP_ID, b)
  }

  // What the rail can select, and the account entries it shows besides only
  // as badges - Discord's, which has no page of its own.
  const selectable = visibleGroups(activeGroups, all)
  const selectableIds = new Set(selectable.map((g) => g.id))
  const shown = [...selectable, ...badgesShown(activeGroups, selectable, effectiveFolders)]
  const extras: RailGroup[] = []
  // Only worth a tile once there is something on it.
  if (all.some(isDirectMessage)) extras.push(dmGroup())
  // No tile for mentions. It is not a place you keep - it is reached from the
  // inbox in the header, which is where the unread count already is, and a
  // permanent tile for it only competed with the servers this column is for.
  if (all.some((b) => !hidden.includes(b.id) && pinned.includes(b.id))) extras.push(pinnedGroup())
  // Invitations from every service share one tile, which is there while
  // anything waits on an answer and gone once nothing does.
  if (invitations.length > 0) extras.push(invitationsGroup(invitations.length))
  const ordered = orderedGroups([...shown, ...extras], railOrder)

  // The rail always draws, even with nothing in it.
  //
  // It used to hide itself below two entries, on the grounds that a column
  // holding one tile is a column with nothing to navigate between. That
  // reasoning missed what else lives here: the cog at the foot is the way to
  // Accounts and Settings, so hiding the rail on a fresh install removed the
  // only route to the screen where an account gets added - exactly when it is
  // the one thing the user needs.

  const layout: RailLayout = { order: railOrder, folders }
  const apply = (next: RailLayout): void => {
    if (next.order !== railOrder) setRailOrder(next.order)
    if (next.folders !== folders) setFolders(next.folders)
  }

  /**
   * Commits whatever drop target the blue indicator is showing (or a fallback
   * target when a drop arrives without a preceding dragover).
   */
  const commitDrop = (fallback?: RailDropTarget): void => {
    const from = draggingRef.current
    const target = activeDropRef.current ?? fallback ?? null
    if (from && target && canDropOn(effectiveFolders, from, target)) {
      if (target.kind === 'tail') {
        apply(moveInRail(ordered, layout, from, { kind: 'end' }, synced))
      } else {
        const { ref, zone } = target
        const folderId = folderIdOf(ref)
        if (folderId !== null) {
          apply(
            moveInRail(
              ordered,
              layout,
              from,
              zone === 'merge' ? { kind: 'into', folder: folderId } : { kind: 'beside', target: ref, after: zone === 'after' },
              synced
            )
          )
        } else {
          const group = ordered.find((g) => g.id === ref)
          if (group && !isFixedEntry(group)) {
            if (zone === 'merge' && group.kind === 'account') {
              const withBadge = withBadgeFolder(folders, group)
              const badge = withBadge.find((f) => f.head === group.id)!
              apply(moveInRail(ordered, { order: railOrder, folders: withBadge }, from, { kind: 'into', folder: badge.id }, synced))
            } else if (zone === 'merge') {
              apply(foldTogether(ordered, layout, group.id, from, synced))
            } else {
              apply(moveInRail(ordered, layout, from, { kind: 'beside', target: group.id, after: zone === 'after' }, synced))
            }
          }
        }
      }
    }
    endDrag()
  }

  const entries = railEntries(ordered, effectiveFolders)

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
      (b) => isDirectMessage(b) && countedFor(b, muted, hidden, mutedGroups) > 0
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
        onBrowse={g.kind === 'space' ? () => setBrowsing(g) : undefined}
        onInvite={
          (g.service === 'stoat' || g.service === 'fluxer') && g.kind === 'guild'
            ? () => {
                const inside = buffers.find((b) => b.groupId === g.id)
                if (!inside) return
                void window.moho
                  .rpc<{ link: string }>('createStoatInvite', { bufferId: inside.id })
                  .then((r) => window.moho.copyText(r.link).then(() => store.toast('info', 'Invite link copied')))
                  .catch((e: Error) => store.toast('error', e.message))
              }
            : undefined
        }
        onSettings={steamGroupOfRail(g.id) ? () => setConfiguring(g) : (g.service === 'stoat' || g.service === 'fluxer') && g.kind === 'guild' ? () => setStoatSettings(g) : undefined}
        unread={t?.unread ?? 0}
        highlight={t?.highlight ?? false}
        mentions={t?.mentions ?? 0}
        // Direct messages and pinned lead the rail by definition, so
        // there is nowhere for them to be dragged to.
        draggable={!isFixedEntry(g)}
        dropAt={dropAt(g.id)}
        lifted={dragging === g.id}
        onSelect={() => store.selectGroup(g.id)}
        onDragStart={() => beginDrag(g.id)}
        onDragOver={(zone) => {
          if (isFixedEntry(g)) return
          setDrop({ kind: 'tile', ref: g.id, zone })
        }}
        onDrop={(zone) => commitDrop({ kind: 'tile', ref: g.id, zone })}
        onDragEnd={endDrag}
      />
    )
  }

  const renderEntry = (entry: RailEntry): JSX.Element => {
    if (entry.kind === 'group') return renderTile(entry.group)
    const open = isFolderOpen(entry.id)
    const head = entry.head
    // A badge counts what its own account page holds as well as its servers.
    const counted = [...(head ? [head] : []), ...entry.members]
    const self = folderRef(entry.id)
    return (
      /* Expanded, the folder and what it holds sit in one panel - the border
         and lighter ground are what say where the folder ends, now that its
         contents are no longer indented. A folder open inside another draws
         its panel inside that one's. */
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
          folder={entry.folder}
          head={head}
          headIcon={head ? customIcons[head.id] : undefined}
          members={entry.members}
          customIcons={customIcons}
          dropAt={dropAt(self)}
          open={open}
          active={!!head && head.id === activeGroupId}
          muted={!!head && mutedGroups.includes(head.id)}
          unread={counted.reduce((n, m) => n + (totals.get(m.id)?.unread ?? 0), 0)}
          highlight={counted.some((m) => totals.get(m.id)?.highlight)}
          mentions={counted.reduce((n, m) => n + (totals.get(m.id)?.mentions ?? 0), 0)}
          onToggle={() => {
            // A badge is its account's page as well as a folder: the first
            // click goes to the page, and opens the folder on the way.
            if (head && selectableIds.has(head.id) && activeGroupId !== head.id) {
              store.selectGroup(head.id)
              if (!open && entry.children.length > 0) setExpanded(entry.id)
            } else if (!head || open || entry.children.length > 0 || !selectableIds.has(head.id)) {
              // A badge with no page and nothing in it still opens, empty:
              // a click that did nothing would read as a broken tile.
              toggleFolder(entry.id)
            }
          }}
          lifted={dragging === self}
          onDragStart={() => beginDrag(self)}
          onContextMenu={(e) => {
            e.preventDefault()
            setFolderMenu({ x: e.clientX, y: e.clientY, entry })
          }}
          // Open, the foot of the folder's tile is the top of what it holds:
          // a drop there goes inside, not below the whole folder.
          onDragOver={(zone) => setDrop({ kind: 'tile', ref: self, zone: open && zone === 'after' ? 'merge' : zone })}
          onDrop={(zone) => commitDrop({ kind: 'tile', ref: self, zone: open && zone === 'after' ? 'merge' : zone })}
          onDragEnd={endDrag}
        />
        {open && entry.children.map(renderEntry)}
      </div>
    )
  }

  return (
    <nav className="server-rail" aria-label="Servers">
      <RailTip />
      {/* Only the entries scroll; the cog stays pinned to the foot. The empty
          space below them is where something is dropped to put it last, and to
          take it back out of a folder on the way - folders themselves are made
          by dropping one icon onto another.

          It has to mean "last" as well as "out of a folder", because the only
          other way to reach the end of the column was the bottom third of the
          last tile, with the merge zone directly above it: aiming for the end
          and making a folder instead was easier than getting it right. */}
      <div
        className={classes('rail-scroll', tailTarget && 'tail-target')}
        onDragOver={(e) => {
          if (!draggingRef.current) return
          const next = resolveRailContainerDrop(e.currentTarget, e.target, e.clientY, draggingRef.current)
          if (next && canDropOn(effectiveFolders, draggingRef.current, next)) {
            e.preventDefault()
            setDrop(next)
          } else {
            setDrop(null)
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null)
        }}
        onDrop={(e) => {
          if (activeDropRef.current) {
            e.preventDefault()
            commitDrop()
          } else {
            endDrag()
          }
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

      {folderMenu && (() => {
        const { entry } = folderMenu
        const head = entry.head
        const headMuted = !!head && mutedGroups.includes(head.id)
        return (
          <ContextMenu
            x={folderMenu.x}
            y={folderMenu.y}
            entries={[
              {
                label: 'Mark Folder As Read',
                icon: 'mark_chat_read',
                onClick: () => void store.markBuffersRead(buffersUnder(entry))
              },
              // A badge is still its account's tile, and mutes like one.
              ...(head
                ? [
                    {
                      label: headMuted ? `Unmute ${head.name}` : `Mute ${head.name}`,
                      icon: headMuted ? 'notifications_active' : 'notifications_off',
                      onClick: () =>
                        setMutedGroups(headMuted ? mutedGroups.filter((x) => x !== head.id) : [...mutedGroups, head.id])
                    } as const
                  ]
                : []),
              { label: 'Folder Settings', icon: 'settings', onClick: () => setSettings(entry.folder) },
              // Closes them; it does not remove them. Removing is below, and
              // marked as the destructive thing it is.
              { label: 'Close All Folders', icon: 'folder', onClick: () => setExpanded('') },
              { separator: true },
              // What it held stays in the rail, where the folder was; only the
              // folder goes. A badge stays too - it is the account's tile - so
              // for one this only empties it.
              head
                ? {
                    label: 'Take Everything Out',
                    icon: 'folder_off',
                    disabled: entry.folder.members.length === 0,
                    onClick: () => apply(dissolveFolder(ordered, layout, entry.id, synced))
                  }
                : {
                    label: 'Remove folder',
                    icon: 'delete',
                    danger: true,
                    onClick: () => apply(dissolveFolder(ordered, layout, entry.id, synced))
                  }
            ]}
            onClose={() => setFolderMenu(null)}
          />
        )
      })()}

      {settings && (
        <FolderSettings
          folder={settings}
          // A badge goes by its account's name.
          named={!settings.head}
          onSave={(name, colour) => {
            setFolders(folders.map((f) => (f.id === settings.id ? { ...f, name, colour } : f)))
            setSettings(null)
          }}
          onClose={() => setSettings(null)}
        />
      )}

      {stoatSettings && buffers.find((b) => b.groupId === stoatSettings.id) && <StoatServerSettings bufferId={buffers.find((b) => b.groupId === stoatSettings.id)!.id} onClose={() => setStoatSettings(null)} />}
      {configuring && <SteamGroupSettings accountId={configuring.accountId} railId={configuring.id} onClose={() => setConfiguring(null)} />}
      {browsing && (
        <SpaceRooms
          accountId={browsing.accountId}
          groupId={browsing.id}
          title={browsing.name}
          onClose={() => setBrowsing(null)}
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
      {/* Where a server is added or joined: pinned below the list with a rule
          above it, so it never moves however many servers there are or
          wherever one is dropped, and the list scrolls above it. For whichever
          account is being looked at. */}
      <button
        type="button"
        className="rail-tile rail-add"
        aria-label="Add or join a server"
        onMouseEnter={(e) => showRailTip(e.currentTarget, 'Add or join a server')}
        onMouseLeave={hideRailTip}
        onClick={() => {
          const account =
            groups.find((g) => g.id === activeGroupId)?.accountId || (store.getSnapshot().accounts[0]?.id ?? '')
          store.setActivePanel('join', account)
        }}
      >
        <span className="rail-face">
          <Icon name="add" size={22} />
        </span>
      </button>
      <RailMenu />
    </nav>
  )
}

/**
 * A folder tile: several servers behind one square.
 *
 * Closed, it shows a grid of what is inside, which is how you recognise a
 * folder you made without opening it. Open, its contents are drawn underneath.
 *
 * A protocol badge's folder keeps the badge as its face instead - it is still
 * the account's tile, and still opens the account's own page - with the folder
 * mark in its corner to say it holds the account's servers.
 */
function FolderTile(props: {
  folder: RailFolder
  /** The account entry, for a badge's folder. */
  head?: RailGroup
  headIcon?: string
  members: RailGroup[]
  customIcons: Record<string, string>
  dropAt: DropZone | null
  lifted: boolean
  open: boolean
  /** The badge's account page is the one being shown. */
  active: boolean
  muted: boolean
  /** What is waiting in the servers inside, so a closed folder can say so. */
  unread: number
  highlight: boolean
  mentions: number
  onToggle: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onDragStart: () => void
  onDragOver: (zone: DropZone) => void
  onDrop: (zone: DropZone) => void
  onDragEnd: () => void
}): JSX.Element {
  const { folder, head, members, customIcons, dropAt, lifted, open, active, muted, unread, mentions } = props
  // Open, its servers show their own; closed, what is inside would be
  // invisible without this.
  const waiting = !open && unread > 0
  const name = head?.name ?? folder.name
  const holding = members.length > 0
  return (
    <button
      type="button"
      className={classes(
        'rail-tile',
        head ? 'rail-badge-folder' : 'rail-folder',
        active && 'active',
        muted && 'muted',
        dropAt === 'merge' && 'merge-target',
        dropAt === 'before' && 'drop-before',
        dropAt === 'after' && 'drop-after',
        lifted && 'lifted'
      )}
      // A folder moves like the servers around it. Without this it could be
      // dropped into but never picked up, which reads as the column having
      // decided where it lives.
      draggable
      onDragStart={(e) => {
        // Chromium abandons a drag whose dataTransfer was never written to.
        e.dataTransfer.setData('text/plain', folder.id)
        e.dataTransfer.effectAllowed = 'move'
        props.onDragStart()
      }}
      onMouseEnter={(e) =>
        showRailTip(
          e.currentTarget,
          head && !holding ? name : `${name} — ${members.length} ${members.length === 1 ? 'server' : 'servers'}`
        )
      }
      onMouseLeave={hideRailTip}
      aria-label={name}
      aria-expanded={open}
      aria-current={active}
      data-rail-ref={folderRef(folder.id)}
      data-rail-open={open ? 'true' : undefined}
      onClick={props.onToggle}
      onContextMenu={props.onContextMenu}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        props.onDragOver(dropZone(e))
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        props.onDrop(dropZone(e))
      }}
      onDragEnd={props.onDragEnd}
    >
      <span className={`rail-pill${active || open ? ' active' : waiting ? ' unread' : ''}`} />
      {head ? (
        // The badge, as it looks loose in the column. The chosen colour rings
        // it rather than tinting it: a service's own mark is not ours to recolour.
        <span
          className="rail-face"
          style={folder.colour ? { boxShadow: `0 0 0 2px ${folder.colour}` } : undefined}
        >
          <GroupFace group={head} customIcon={props.headIcon} />
        </span>
      ) : (
        /* The same face whether or not it is showing its contents: a folder
           is a folder, and an icon that changes underfoot is one more thing
           to read. Empty it is just a folder; once there is something in it,
           the faces of what is inside - up to four, which is as many as read
           at this size. */
        <span
          className="rail-face folder-face"
          // The chosen colour is on the tile itself, not only on the panel it
          // opens into. Closed is how a folder spends most of its life, and a
          // colour you picked to tell two folders apart is no use only once one
          // of them is open. Tinted rather than filled: four other people's
          // icons sit on top of it and have to stay readable.
          style={folder.colour ? { color: folder.colour, background: `${folder.colour}5c` } : undefined}
        >
          {!holding ? (
            <Icon name="folder" size={26} />
          ) : (
            members.slice(0, 4).map((m) => (
              <span key={m.id} className="folder-chip">
                <GroupFace group={m} customIcon={customIcons[m.id]} />
              </span>
            ))
          )}
        </span>
      )}
      {muted && (
        <span className="rail-muted" title="Muted">
          <Icon name="notifications_off" size={11} />
        </span>
      )}
      {/* Once the face is a grid of other people's icons, nothing says it is a
          folder any more, so it takes the same corner badge a guild uses to
          name its service. A protocol badge always does, empty or not: its face
          is the same mark an account's tile has, and this is what says it is a
          folder. An empty folder of the user's own is already unmistakably one. */}
      {(holding || head) && !(!open && mentions > 0) && (
        <span className="rail-service">
          <Icon name={open ? 'folder_open' : 'folder'} size={11} />
        </span>
      )}
      {!open && mentions > 0 && (
        <span className="rail-count highlight" title={`${mentions} mention${mentions === 1 ? '' : 's'}`}>
          {mentions > 99 ? '99+' : mentions}
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
  named,
  onSave,
  onClose
}: {
  folder: RailFolder
  /** Whether it has a name of its own to edit; a badge's folder goes by its account's. */
  named: boolean
  onSave: (name: string, colour?: string) => void
  onClose: () => void
}): JSX.Element {
  const [name, setName] = useState(folder.name)
  const [colour, setColour] = useState(folder.colour)

  return (
    <Modal title="Folder Settings" icon="folder" className="modal folder-settings" onClose={onClose}>

        {named && (
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
        )}

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
    </Modal>
  )
}

/**
 * The cog at the foot of the rail: the way into Accounts and Settings, which
 * used to sit in the channel list's own footer. They belong here because they
 * are about the app rather than about whichever server is selected.
 */
function RailMenu(): JSX.Element {
  const store = useStore()
  const transfers = useChat((s) => s.transfers)
  // What is going on behind whatever is on screen. Exports count alongside
  // files because they are the same thing to somebody who started one and
  // wandered off - and a paused one still counts, since it is waiting on a
  // decision rather than finished.
  const running = transfers.filter(
    (t) => t.state === 'offered' || t.state === 'receiving' || t.state === 'paused'
  )
  const busy = running.length
  const exporting = running.filter((t) => t.kind === 'export').length
  // Said in the words of whatever is actually happening: "3 file(s) arriving"
  // while a conversation is being written to disk is a sentence about the
  // wrong thing.
  const busyLabel =
    exporting === busy
      ? `${busy} export${busy === 1 ? '' : 's'} running`
      : exporting > 0
        ? `${busy} in progress, ${exporting} of them export${exporting === 1 ? '' : 's'}`
        : `${busy} file${busy === 1 ? '' : 's'} arriving`

  return (
    <>
      <button
        type="button"
        className="rail-tile rail-cog"
        title={busy > 0 ? `Settings - ${busyLabel}` : 'Settings'}
        aria-label="Settings"
        // Straight to Settings, where Accounts and Downloads are pages of it.
        onClick={() => store.setActivePanel('settings')}
      >
        <span className="rail-face">
          <Icon name="settings" size={20} />
        </span>
        {/* Where a minimised transfer goes, so putting one away does not look
            like losing it. A count rather than a dot, because the number is
            the thing you are checking when you look. */}
        {busy > 0 && (
          <span className={exporting > 0 ? 'rail-downloads exporting' : 'rail-downloads'}>{busy}</span>
        )}
      </button>
    </>
  )
}

/** The flyout every tile in the column points at; one, wherever the pointer is. */
function RailTip(): JSX.Element | null {
  const [tip, setTip] = useState<RailTipDetail | null>(null)
  useEffect(() => {
    const on = (e: Event): void => setTip((e as CustomEvent<RailTipDetail>).detail)
    window.addEventListener(RAIL_TIP, on)
    return () => window.removeEventListener(RAIL_TIP, on)
  }, [])
  if (!tip?.rect) return null
  return createPortal(
    <div
      className="rail-tip"
      role="tooltip"
      style={{ left: tip.rect.right + 8, top: tip.rect.top + tip.rect.height / 2 }}
    >
      {tip.text}
    </div>,
    document.body
  )
}
