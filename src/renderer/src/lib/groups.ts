import type { BufferGroup } from '../../../shared/wire'
import type { BufferEntry } from '../state/store'
import { appliedLevelOf } from './notifylevels'

/**
 * A rail entry as the UI knows it: everything nobilis reports, plus the
 * pinned page this app synthesises. Kept as a superset here rather than
 * widening the wire type, which should only describe what the daemon
 * actually sends.
 */
export type RailGroup = Omit<BufferGroup, 'kind'> & {
  kind: BufferGroup['kind'] | 'pinned' | 'invitations'
}

/**
 * The page gathering every invitation waiting on an answer, from every service.
 *
 * One tile rather than one per invitation, because what they have in common
 * is that they are waiting on you and expire once answered, not which service
 * sent them. Like the pinned page it belongs to no account and exists only
 * while there is something on it.
 */
export const INVITATIONS_GROUP_ID = '~invitations'

export function invitationsGroup(count: number): RailGroup {
  return {
    id: INVITATIONS_GROUP_ID,
    accountId: '',
    service: '',
    kind: 'invitations',
    name: count > 1 ? `Invitations (${count})` : 'Invitations',
    // Ahead of everything: it is the only entry that expires if nobody answers.
    position: -2000
  }
}

/**
 * The rail entry collecting pinned buffers from every service.
 *
 * Client-side rather than a nobilis group: pinning is a preference this app
 * owns, not something the daemon knows or should know about. It is given a
 * group id anyway so selection, persistence and the channel pane all treat it
 * exactly like any other entry.
 */
export const PINNED_GROUP_ID = '~pinned'
/**
 * The page gathering every mention, across every service.
 *
 * An id with no rail tile behind it, unlike the other two here. The mentions
 * page is reached from the inbox in the header - which already carries the
 * unread count, so a tile would have been a second place saying the same
 * thing while taking a slot in a column that is for servers.
 */
export const MENTIONS_GROUP_ID = '~mentions'

/**
 * The rail entry collecting direct messages from every service.
 *
 * Synthesised here rather than taken from nobilis for the same reason as
 * pinned: the daemon reports one DM group per account that has them, which is
 * correct as a statement about Discord's own grouping but would put an IRC
 * query under the IRC tile and a Matrix DM under the Matrix tile. A person
 * messaging you is a person messaging you, whichever network carried it, so
 * the rail folds them into one page and suppresses the per-account ones.
 */
export const DM_GROUP_ID = '~dms'

export function dmGroup(): RailGroup {
  return {
    id: DM_GROUP_ID,
    accountId: '',
    service: '',
    kind: 'dms',
    name: 'Direct Messages',
    position: -1000
  }
}

/** Whether a buffer belongs on the cross-service direct messages page. */
export function isDirectMessage(buffer: BufferEntry): boolean {
  return buffer.kind === 'dm'
}

/**
 * The number to show beside a conversation: what is addressed to you.
 *
 * Mentions, not everything said - a bold name already says there is activity,
 * and a count of it is the noise the rail and tray were rid of. A direct
 * message is the exception that is the same rule: every line in one is
 * addressed to you, so it is counted by each unread message - unless it is
 * muted, which is asking not to hear about it at all.
 *
 * What a conversation is set to bends the rule the way it bends what
 * interrupts: mentions only counts only mentions even in a direct message, and
 * every message counts every message even in a channel.
 *
 * A muted channel still counts the times your name was used in it. Muting is
 * about being interrupted - a popup, a sound, a phone buzzing - not about
 * hiding that you were asked for; Discord and Element both keep that badge.
 */
export function waitingCount(buffer: BufferEntry, muted = false): number {
  const level = appliedLevelOf(buffer)
  if (isDirectMessage(buffer)) {
    if (muted) return 0
    // Told only of what names you, a direct message is counted like a channel.
    return level === 'mentions' || level === 'direct' ? buffer.mentions : buffer.unread
  }
  // Told of every message, each is an interruption and each is counted.
  return level === 'all' ? buffer.unread : buffer.mentions
}

export function pinnedGroup(): RailGroup {
  return {
    id: PINNED_GROUP_ID,
    accountId: '',
    service: '',
    kind: 'pinned',
    name: 'Pinned',
    position: -900,
  }
}

/** Account ids the user has explicitly disconnected. */
export function disconnectedAccountIds(accounts: { id: string; disconnected?: boolean }[]): Set<string> {
  return new Set(accounts.filter((a) => a.disconnected).map((a) => a.id))
}

/**
 * The rail entries worth drawing.
 *
 * An account entry is the home for buffers no backend grouped, which is how
 * IRC, Sneedchat and Matrix reach the rail at all. Discord never puts anything
 * there - every channel belongs to a guild and every DM to the DM entry - so
 * its account entry would be a tile that opens an empty pane.
 *
 * Emptiness alone is not enough to hide one: IRC and Sneedchat have no buffers
 * either until they finish connecting, and Sneedchat's Tor bootstrap makes
 * that several seconds. So an account with nothing anywhere yet keeps its
 * tile, and only one whose buffers all live elsewhere loses it.
 *
 * Shared by the rail and the channel pane deliberately - if they disagreed,
 * the selected group could be one with no tile, leaving a pane the user cannot
 * navigate away from.
 */
export function visibleGroups(groups: BufferGroup[], buffers: BufferEntry[]): BufferGroup[] {
  const inGroup = new Map<string, number>()
  const inAccount = new Map<string, number>()
  for (const b of buffers) {
    inAccount.set(b.accountId, (inAccount.get(b.accountId) ?? 0) + 1)
    if (b.groupId) inGroup.set(b.groupId, (inGroup.get(b.groupId) ?? 0) + 1)
  }
  return groups.filter((g) => {
    // Folded into the one cross-service direct messages page.
    if (g.kind === 'dms') return false
    if (g.kind !== 'account') return true
    if ((inGroup.get(g.id) ?? 0) > 0) return true
    return (inAccount.get(g.accountId) ?? 0) === 0
  })
}

/** Entries the user cannot drag, and which always lead the rail. */
export function isFixedEntry(group: RailGroup): boolean {
  return group.kind === 'dms' || group.kind === 'pinned' || group.kind === 'invitations'
}

/**
 * The rail in display order: direct messages, then pinned, then everything
 * else in whatever order the user dragged them into.
 *
 * `order` holds only what has been dragged. Anything absent - a guild joined
 * since, or a rail never rearranged - keeps nobilis's own ordering and sorts
 * after what has been placed, so a new server appears at the end rather than
 * silently rearranging a rail the user already arranged.
 */
export function orderedGroups(groups: RailGroup[], order: string[]): RailGroup[] {
  const rank = new Map(order.map((id, i) => [id, i]))
  // Invitations, then direct messages, then pinned. Stated as a rule rather than left to the
  // position numbers, which are the backend's business and were never meant
  // to encode this.
  const leadRank = (g: RailGroup): number => (g.kind === 'invitations' ? -1 : g.kind === 'dms' ? 0 : 1)
  const lead = groups
    .filter(isFixedEntry)
    .sort((a, b) => leadRank(a) - leadRank(b) || a.position - b.position)
  const rest = groups.filter((g) => !isFixedEntry(g))

  rest.sort((a, b) => {
    const ra = rank.get(a.id)
    const rb = rank.get(b.id)
    if (ra !== undefined && rb !== undefined) return ra - rb
    if (ra !== undefined) return -1
    if (rb !== undefined) return 1
    return a.position - b.position || a.name.localeCompare(b.name)
  })
  return [...lead, ...rest]
}

/**
 * Whether a buffer is muted, on its own account or by the rail entry it sits
 * under.
 *
 * Muting a buffer mutes that buffer and nothing else - including the server
 * buffer, which used to cascade to every channel on the account. The cascade
 * was wrong for the case that makes muting a server buffer worth doing at
 * all: an IRC network chatters through its whole connection, and some of that
 * chatter carries your nick, so the notices fire. Silencing it should not be
 * a choice between "hear the MOTD" and "hear nothing on this network".
 *
 * Muting a whole network is still one action - it is the rail tile's mute,
 * which is the deliberate way to say it and is always undoable from a tile
 * that is always on screen.
 *
 * Shared by the rail and the channel pane for the same reason the visibility
 * rule is: they disagreed before, and the rail counted unread from muted
 * buffers while the rows underneath refused to badge them - so a tile could
 * read 40 waiting with nothing beneath it to explain where.
 */
export function isMutedBuffer(
  buffer: BufferEntry,
  muted: string[],
  mutedGroups: string[] = []
): boolean {
  // An explicit mute on this buffer always stands.
  if (muted.includes(buffer.id)) return true

  // And so does one that is muted by whoever keeps the setting - the account
  // for Matrix and Discord, the daemon for the rest - including a channel left
  // on its default inside a server that is muted. Every other device signed in
  // to that account is already keeping quiet about it.
  if (appliedLevelOf(buffer) === 'mute') return true

  // A muted server, guild or space silences everything under it.
  return !!buffer.groupId && mutedGroups.includes(buffer.groupId)
}

/**
 * What a conversation adds to a rail tile or the tray: its waiting count, or
 * nothing at all if it is hidden, which has no row to click through to.
 *
 * Muting does not remove it. A muted place is not interrupting anybody - no
 * popup, no sound, no buzz on a phone - but the times it asked for you are
 * still true, and a tile that hid them would send you looking in the wrong
 * place. What a mute does take away is a direct message's count, since that
 * is everything said in it rather than anything that was meant for you in
 * particular.
 */
export function countedFor(
  buffer: BufferEntry,
  muted: string[],
  hidden: string[],
  mutedGroups: string[] = []
): number {
  if (hidden.includes(buffer.id)) return 0
  return waitingCount(buffer, isMutedBuffer(buffer, muted, mutedGroups))
}


/**
 * The colours a folder can be given.
 *
 * A fixed set rather than a picker: these have to stay legible against the
 * rail and as a tint behind a panel of icons, which an arbitrary colour will
 * not. Named so the choice reads as a decision rather than a hex value.
 */
export const FOLDER_COLOURS: { name: string; value: string }[] = [
  { name: 'Blurple', value: '#5865f2' },
  { name: 'Crimson', value: '#ed4245' },
  { name: 'Rose', value: '#eb459e' },
  { name: 'Amber', value: '#faa61a' },
  { name: 'Green', value: '#3ba55d' },
  { name: 'Teal', value: '#1abc9c' },
  { name: 'Sky', value: '#3498db' },
  { name: 'Violet', value: '#9b59b6' },
  { name: 'Slate', value: '#95a5a6' }
]

/**
 * A folder in the rail: several entries behind one tile.
 *
 * Entirely this client's idea. Discord has folders of its own, but they are
 * per-account and say nothing about the Matrix spaces or IRC networks sitting
 * beside them in the same column - and the point of the rail is that those all
 * live together. So a folder here can hold anything the rail can show,
 * including other folders.
 */
export interface RailFolder {
  id: string
  name: string
  /**
   * What it holds, in the order it was put in: group ids, and the folders
   * nested inside it as {@link folderRef}s.
   */
  members: string[]
  /** A colour, so one folder is told from another at a glance. */
  colour?: string
  /**
   * The account entry this folder belongs to, on a protocol badge's folder.
   *
   * The badge is the folder's face and opens the account's own page (Stoat's
   * notes and direct messages) as well as holding its servers - which is where
   * a server the account joins lands, so a new one does not turn up loose at
   * the foot of a column somebody arranged.
   */
  head?: string
}

/**
 * How a folder is named wherever a group id could also stand: among another
 * folder's members, and while it is being dragged.
 *
 * Said in the string rather than looked up and hoped for - a folder id and a
 * group id are both opaque, and mistaking one for the other files a folder
 * inside itself.
 */
export const FOLDER_DRAG_PREFIX = 'folder:'

export const folderRef = (id: string): string => `${FOLDER_DRAG_PREFIX}${id}`

export function folderIdOf(ref: string): string | null {
  return ref.startsWith(FOLDER_DRAG_PREFIX) ? ref.slice(FOLDER_DRAG_PREFIX.length) : null
}

/** The folder a protocol badge heads: derived from the account's entry, so it only ever has one. */
export const badgeFolderId = (accountGroupId: string): string => `badge:${accountGroupId}`

/** What the rail draws, top to bottom: loose entries and folders, in order. */
export type RailEntry = { kind: 'group'; id: string; group: RailGroup } | RailFolderEntry

export interface RailFolderEntry {
  kind: 'folder'
  id: string
  folder: RailFolder
  /** The protocol badge heading it, when it is one and its account is here. */
  head?: RailGroup
  /** What is drawn inside it when it is open, the folders nested in it included. */
  children: RailEntry[]
  /**
   * Every server anywhere inside, the badges of nested folders included and its
   * own not: what its face shows and what its counts add up.
   */
  members: RailGroup[]
}

/** The ref an entry is dragged and filed by. */
export const refOf = (e: RailEntry): string => (e.kind === 'group' ? e.id : folderRef(e.id))

/**
 * Folders with each member written as what it is drawn as.
 *
 * An account's entry filed into a folder before its badge had a folder of its
 * own is that folder once it has one: the badge and what it holds move
 * together. Anything claimed twice stays with the first folder to claim it, so
 * nothing is drawn in two places.
 */
export function normalizedFolders(folders: RailFolder[]): RailFolder[] {
  const headed = new Map<string, string>()
  for (const f of folders) if (f.head && !headed.has(f.head)) headed.set(f.head, f.id)
  const claimed = new Set<string>()
  return folders.map((f) => {
    const members: string[] = []
    for (const m of f.members) {
      const ref = headed.has(m) ? folderRef(headed.get(m)!) : m
      if (ref === folderRef(f.id) || claimed.has(ref)) continue
      claimed.add(ref)
      members.push(ref)
    }
    return { ...f, members }
  })
}

/** The folder holding `ref` directly, if one does. */
export function parentOf(folders: RailFolder[], ref: string): RailFolder | undefined {
  return folders.find((f) => f.members.includes(ref))
}

/** The folders around `ref`, innermost first. */
export function ancestorsOf(folders: RailFolder[], ref: string): string[] {
  const out: string[] = []
  let at = parentOf(folders, ref)
  while (at && !out.includes(at.id)) {
    out.push(at.id)
    at = parentOf(folders, folderRef(at.id))
  }
  return out
}

/**
 * The local folders plus whatever a service keeps for the account (Fluxer's
 * guild folders), which only get what nothing local has claimed.
 */
export function withSynced(local: RailFolder[], synced: RailFolder[]): RailFolder[] {
  if (synced.length === 0) return local
  const claimed = new Set(local.flatMap((f) => f.members))
  const rest = synced
    .map((f) => ({ ...f, members: f.members.filter((m) => !claimed.has(m)) }))
    .filter((f) => f.members.length > 0)
  return [...local, ...rest]
}

/**
 * Folds the ordered groups into the rail's real layout.
 *
 * A folder takes the position of the first thing inside it - its badge, or
 * its topmost server - so putting servers into one does not also reshuffle the
 * column. What it holds comes back attached to it rather than spliced into the
 * list, folders inside folders included, because the rail draws an expanded
 * folder and its contents inside one container.
 */
export function railEntries(ordered: RailGroup[], given: RailFolder[]): RailEntry[] {
  const folders = normalizedFolders(given)
  const byId = new Map(folders.map((f) => [f.id, f]))
  const present = new Map(ordered.map((g) => [g.id, g]))
  const parent = new Map<string, string>()
  for (const f of folders) for (const m of f.members) parent.set(m, f.id)
  const headed = new Map<string, string>()
  for (const f of folders) if (f.head && !headed.has(f.head)) headed.set(f.head, f.id)

  const build = (f: RailFolder, seen: Set<string>): RailFolderEntry => {
    seen.add(f.id)
    const children: RailEntry[] = []
    // In the folder's own order, not the rail's: that order is the one the
    // person set by dropping things in.
    for (const m of f.members) {
      const inner = folderIdOf(m)
      if (inner !== null) {
        const child = byId.get(inner)
        if (child && !seen.has(inner)) children.push(build(child, seen))
        continue
      }
      const g = present.get(m)
      if (g) children.push({ kind: 'group', id: g.id, group: g })
    }
    const members = children.flatMap((c) =>
      c.kind === 'group' ? [c.group] : [...(c.head ? [c.head] : []), ...c.members]
    )
    const found = f.head ? present.get(f.head) : undefined
    // A badge is the protocol's mark, not the account's picture: the daemon
    // gives an account's entry its avatar, and Discord's then read as one more
    // server rather than as Discord. Wherever a badge is drawn - its own tile,
    // or a chip in the face of a folder holding it - it says which service.
    const head = found && { ...found, iconUrl: undefined }
    return { kind: 'folder', id: f.id, folder: f, head, children, members }
  }

  // The outermost thing a ref is drawn inside of.
  const topOf = (ref: string): string => {
    const seen = new Set<string>()
    let at = ref
    while (parent.has(at) && !seen.has(at)) {
      seen.add(at)
      at = folderRef(parent.get(at)!)
    }
    return at
  }

  const out: RailEntry[] = []
  const placed = new Set<string>()
  for (const g of ordered) {
    const top = topOf(headed.has(g.id) ? folderRef(headed.get(g.id)!) : g.id)
    const id = folderIdOf(top)
    if (id === null) {
      out.push({ kind: 'group', id: g.id, group: g })
      continue
    }
    if (placed.has(id)) continue
    placed.add(id)
    out.push(build(byId.get(id)!, new Set()))
  }

  // A folder with nothing in it still draws, at the foot of the column. A
  // new one is empty by definition, and a folder that only appears once it
  // has members can never be given any. Not a badge's: that one is its
  // account's tile, and with the account gone there is nothing for it to be.
  for (const f of folders) {
    if (placed.has(f.id) || parent.has(folderRef(f.id)) || f.head) continue
    out.push(build(f, new Set()))
  }
  return out
}

/** Where the rail keeps its arrangement: the order of the column, and the folders in it. */
export interface RailLayout {
  order: string[]
  folders: RailFolder[]
}

/** Where on a tile something is being dropped. */
export type DropZone = 'before' | 'merge' | 'after'

/** What the rail's drag indicator is pointing at, and what a drop will commit. */
export type RailDropTarget =
  | { kind: 'tile'; ref: string; zone: DropZone }
  | { kind: 'tail' }
  | null

/** Vertical bounds of one draggable entry in a rail container. */
export interface RailSlot {
  ref: string
  top: number
  bottom: number
  openFolder?: boolean
}

/**
 * Whether dropping `from` onto `target` is valid (never onto itself or a
 * folder into one of its own descendants).
 */
export function canDropOn(folders: RailFolder[], from: string, target: RailDropTarget): boolean {
  if (!from || !target) return false
  if (target.kind === 'tail') return true
  if (target.ref === from) return false
  const moving = folderIdOf(from)
  if (moving !== null && ancestorsOf(folders, target.ref).includes(moving)) return false
  return true
}

/**
 * Resolves a drag-over position in the gap between tiles (or below the column)
 * to the exact drop target matching the blue insertion line.
 *
 * Without this, hovering the 4px gap where the blue line is drawn fell through
 * to the scroll container's "put it last" handler (or got rejected inside an
 * open folder), sending the icon to the bottom while the blue line sat between
 * two icons.
 */
export function resolveGapDrop(
  items: RailSlot[],
  clientY: number,
  dragging: string,
  options: {
    allowTail?: boolean
    folderRef?: string
    headerTop?: number
    headerBottom?: number
  } = {}
): RailDropTarget {
  const { allowTail = false, folderRef: openFolderRef, headerTop, headerBottom } = options

  if (openFolderRef !== undefined && headerTop !== undefined && headerBottom !== undefined) {
    if (clientY < headerTop) {
      return openFolderRef === dragging ? null : { kind: 'tile', ref: openFolderRef, zone: 'before' }
    }
    if (items.length === 0) {
      return clientY >= headerBottom && openFolderRef !== dragging
        ? { kind: 'tile', ref: openFolderRef, zone: 'merge' }
        : null
    }
    if (clientY >= headerBottom && clientY <= items[0].top) {
      return items[0].ref === dragging ? null : { kind: 'tile', ref: items[0].ref, zone: 'before' }
    }
    for (let i = 0; i < items.length - 1; i++) {
      if (clientY >= items[i].bottom && clientY <= items[i + 1].top) {
        if (items[i + 1].ref !== dragging) return { kind: 'tile', ref: items[i + 1].ref, zone: 'before' }
        if (!items[i].openFolder && items[i].ref !== dragging) return { kind: 'tile', ref: items[i].ref, zone: 'after' }
        return null
      }
    }
    const last = items[items.length - 1]
    if (clientY > last.bottom) {
      if (!last.openFolder && last.ref !== dragging) return { kind: 'tile', ref: last.ref, zone: 'after' }
      if (last.openFolder && openFolderRef !== dragging) return { kind: 'tile', ref: openFolderRef, zone: 'merge' }
    }
    return null
  }

  if (items.length === 0) return null
  if (clientY > items[items.length - 1].bottom) {
    return allowTail ? { kind: 'tail' } : null
  }
  if (clientY < items[0].top) {
    if (items[0].top - clientY <= 8 && items[0].ref !== dragging) {
      return { kind: 'tile', ref: items[0].ref, zone: 'before' }
    }
    return null
  }
  for (let i = 0; i < items.length - 1; i++) {
    if (clientY >= items[i].bottom && clientY <= items[i + 1].top) {
      if (items[i + 1].ref !== dragging) return { kind: 'tile', ref: items[i + 1].ref, zone: 'before' }
      if (!items[i].openFolder && items[i].ref !== dragging) return { kind: 'tile', ref: items[i].ref, zone: 'after' }
      return null
    }
  }
  return null
}

/** Where something dragged was let go. */
export type RailDrop =
  /** Above or below an entry, at whatever depth that entry is. */
  | { kind: 'beside'; target: string; after: boolean }
  /** On a folder: last inside it. */
  | { kind: 'into'; folder: string }
  /** The open space under the column: last in it, and out of any folder. */
  | { kind: 'end' }

/** Every server under an entry, its badge first: the run it takes up in the saved order. */
function idsUnder(e: RailEntry): string[] {
  return e.kind === 'group' ? [e.id] : [...(e.head ? [e.head.id] : []), ...e.children.flatMap(idsUnder)]
}

/** Whether `ref` is this entry or anywhere inside it. */
function holds(e: RailEntry, ref: string): boolean {
  if (refOf(e) === ref) return true
  if (e.kind === 'group') return false
  return e.head?.id === ref || e.children.some((c) => holds(c, ref))
}

function topLevel(ordered: RailGroup[], folders: RailFolder[]): RailEntry[] {
  return railEntries(ordered, folders).filter((e) => !(e.kind === 'group' && isFixedEntry(e.group)))
}

/**
 * The order to save for a column whose top level reads `refs`.
 *
 * Written out in full rather than as an edit, so the saved order stays
 * meaningful as servers come and go. What the rail cannot see right now - an
 * account still connecting - keeps its place at the end instead of being
 * dropped: a server missing from the order is one the rail has never placed,
 * and would be filed away under its badge as if it had just been joined.
 */
function orderFor(
  ordered: RailGroup[],
  folders: RailFolder[],
  refs: string[],
  previous: string[],
  keep: string[] = []
): string[] {
  const entries = topLevel(ordered, folders)
  const byRef = new Map(entries.map((e) => [refOf(e), e]))
  const tops = [...refs.filter((r) => byRef.has(r)), ...entries.map(refOf).filter((r) => !refs.includes(r))]
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of [...tops.flatMap((r) => idsUnder(byRef.get(r)!)), ...previous, ...keep]) {
    if (folderIdOf(id) !== null || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * Moves a server or a folder - a badge with everything under it - to where it
 * was dropped.
 *
 * Beside something inside a folder puts it in that folder, beside that thing;
 * beside something at the top puts it at the top. A folder never goes inside
 * itself, however deep the place it was dropped.
 */
export function moveInRail(
  ordered: RailGroup[],
  layout: RailLayout,
  ref: string,
  to: RailDrop,
  synced: RailFolder[] = []
): RailLayout {
  const folders = normalizedFolders(layout.folders)
  if (to.kind === 'beside' && to.target === ref) return layout
  const host =
    to.kind === 'into'
      ? folders.find((f) => f.id === to.folder)
      : to.kind === 'beside'
        ? parentOf(folders, to.target)
        : undefined
  // A folder the service keeps is not this client's to fill.
  if (to.kind === 'into' && !host) return layout
  const moving = folderIdOf(ref)
  if (moving !== null && host && (host.id === moving || ancestorsOf(folders, folderRef(host.id)).includes(moving))) {
    return layout
  }

  const before = topLevel(ordered, withSynced(folders, synced)).map(refOf)
  let next = folders.map((f) => ({ ...f, members: f.members.filter((m) => m !== ref) }))
  if (host) {
    next = next.map((f) => {
      if (f.id !== host.id) return f
      const members = [...f.members]
      const i = to.kind === 'beside' ? members.indexOf(to.target) : -1
      members.splice(i === -1 ? members.length : i + (to.kind === 'beside' && to.after ? 1 : 0), 0, ref)
      return { ...f, members }
    })
  }

  const after = topLevel(ordered, withSynced(next, synced))
  const tops = after.map(refOf)
  const refs = before.filter((r) => r !== ref && tops.includes(r))
  if (!host && tops.includes(ref)) {
    let at = refs.length
    if (to.kind === 'beside') {
      const i = refs.findIndex((r) => {
        const e = after.find((x) => refOf(x) === r)
        return !!e && holds(e, to.target)
      })
      if (i !== -1) at = i + (to.after ? 1 : 0)
    }
    refs.splice(at, 0, ref)
  }
  return { order: orderFor(ordered, withSynced(next, synced), refs, layout.order), folders: next }
}

/**
 * Makes a folder of two things, the way dropping one onto another does.
 *
 * The new folder takes the place of the one that was already there - at the
 * top of the column or inside whatever folder held it - so nothing around the
 * gesture moves.
 */
export function foldTogether(
  ordered: RailGroup[],
  layout: RailLayout,
  ontoId: string,
  ref: string,
  synced: RailFolder[] = [],
  id = `folder-${Date.now().toString(36)}`
): RailLayout {
  if (ontoId === ref) return layout
  const folders = normalizedFolders(layout.folders)
  const moving = folderIdOf(ref)
  if (moving !== null && ancestorsOf(folders, ontoId).includes(moving)) return layout
  const host = parentOf(folders, ontoId)
  const before = topLevel(ordered, withSynced(folders, synced)).map(refOf)
  const made = folderRef(id)
  const next: RailFolder[] = [
    ...folders.map((f) => ({
      ...f,
      members: f.members.filter((m) => m !== ref).map((m) => (m === ontoId ? made : m))
    })),
    { id, name: 'New folder', members: [ontoId, ref] }
  ]
  const tops = topLevel(ordered, withSynced(next, synced)).map(refOf)
  const refs = before
    .filter((r) => r !== ref)
    .map((r) => (r === ontoId && !host ? made : r))
    .filter((r) => tops.includes(r))
  return { order: orderFor(ordered, withSynced(next, synced), refs, layout.order), folders: next }
}

/** The folders with `head`'s badge given a folder of its own, if it has none yet. */
export function withBadgeFolder(folders: RailFolder[], head: Pick<RailGroup, 'id' | 'name'>): RailFolder[] {
  if (folders.some((f) => f.head === head.id)) return folders
  return [...folders, { id: badgeFolderId(head.id), name: head.name, members: [], head: head.id }]
}

/**
 * Takes a folder apart, leaving what it held where it was.
 *
 * Its contents take its place - at the top of the column, or inside the folder
 * it sat in. A badge's folder is emptied rather than removed: the badge is its
 * account's tile, and stays.
 */
export function dissolveFolder(
  ordered: RailGroup[],
  layout: RailLayout,
  folderId: string,
  synced: RailFolder[] = []
): RailLayout {
  const folders = normalizedFolders(layout.folders)
  const f = folders.find((x) => x.id === folderId)
  if (!f) return layout
  const self = folderRef(f.id)
  const host = parentOf(folders, self)
  const spill = (r: string): string[] => (r !== self ? [r] : f.head ? [r, ...f.members] : f.members)
  const before = topLevel(ordered, withSynced(folders, synced)).map(refOf)
  const next = folders
    .filter((x) => x.id !== f.id || f.head)
    .map((x) =>
      x.id === f.id ? { ...x, members: [] } : x.id === host?.id ? { ...x, members: x.members.flatMap(spill) } : x
    )
  const tops = topLevel(ordered, withSynced(next, synced)).map(refOf)
  const refs = (host ? before : before.flatMap(spill)).filter((r) => tops.includes(r))
  // Its servers that are not here right now are remembered as placed, or they
  // would be filed straight back under their badge when they reappear.
  return { order: orderFor(ordered, withSynced(next, synced), refs, layout.order, f.members), folders: next }
}

/**
 * Files each server the rail has never placed under its account's badge, and
 * gives every account that has servers a badge to file them under.
 *
 * "Never placed" is neither in the saved order nor in any folder: a server
 * somebody took out of its badge's folder is in the order from that moment, so
 * it stays where it was put. Returns null when there is nothing new.
 */
export function fileNewServers(
  groups: RailGroup[],
  layout: RailLayout,
  synced: RailFolder[] = []
): RailFolder[] | null {
  const known = new Set(layout.order)
  for (const f of [...layout.folders, ...synced]) for (const m of f.members) known.add(m)
  let folders = layout.folders
  for (const g of groups) {
    if (g.kind !== 'guild' && g.kind !== 'space') continue
    const head = groups.find((h) => h.kind === 'account' && h.accountId === g.accountId)
    if (!head) continue
    // Every account with servers has its badge, even when all of them were
    // placed elsewhere: it is where they go back to.
    folders = withBadgeFolder(folders, head)
    if (known.has(g.id)) continue
    folders = folders.map((f) => (f.head === head.id ? { ...f, members: [...f.members, g.id] } : f))
    known.add(g.id)
  }
  return folders === layout.folders ? null : folders
}

/**
 * The account entries the rail has to show as badges, though the account has
 * nothing of its own to open.
 *
 * Discord's account entry would open an empty pane - all its channels live in
 * guilds - so it is no page. But it is the folder its guilds are filed in, and
 * the place to drop one back into, so it shows for as long as the account has
 * servers, or its badge holds anything at all.
 */
export function badgesShown(groups: RailGroup[], shown: RailGroup[], given: RailFolder[]): RailGroup[] {
  const folders = normalizedFolders(given)
  const here = new Set(shown.map((g) => g.id))
  const byId = new Map(folders.map((f) => [f.id, f]))
  const holdsAny = (f: RailFolder, seen: Set<string>): boolean => {
    seen.add(f.id)
    return f.members.some((m) => {
      const inner = folderIdOf(m)
      if (inner === null) return here.has(m)
      const child = byId.get(inner)
      return !!child && !seen.has(inner) && (here.has(child.head ?? '') || holdsAny(child, seen))
    })
  }
  const withServers = new Set(groups.filter((g) => g.kind === 'guild' || g.kind === 'space').map((g) => g.accountId))
  return groups.filter(
    (g) =>
      g.kind === 'account' &&
      !here.has(g.id) &&
      folders.some((f) => f.head === g.id && (withServers.has(g.accountId) || holdsAny(f, new Set())))
  )
}

/**
 * How two conversations in the same band of the list are ordered.
 *
 * Direct messages go by when they last spoke, as in every chat client: a
 * person who just wrote to you is where you look. Channels do not. A channel
 * list that reorders itself as each message arrives is a list nobody can click
 * - the row moves between the pointer going to it and the click - and a busy
 * network turns it into a column of rows in constant motion. So channels, and
 * what is pinned, hold the order the service gave them (its own position),
 * then alphabetical, and an unread badge says which one has something.
 */
export function compareInBand(
  a: Pick<BufferEntry, 'kind' | 'name' | 'position' | 'lastActivityTs'>,
  b: Pick<BufferEntry, 'kind' | 'name' | 'position' | 'lastActivityTs'>
): number {
  if (a.kind === 'dm' && b.kind === 'dm') return (b.lastActivityTs || 0) - (a.lastActivityTs || 0)
  return (a.position || 0) - (b.position || 0) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}
