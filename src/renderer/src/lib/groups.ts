import type { BufferGroup } from '../../../shared/wire'
import type { BufferEntry } from '../state/store'

/**
 * A rail entry as the UI knows it: everything nobilis reports, plus the
 * pinned page this app synthesises. Kept as a superset here rather than
 * widening the wire type, which should only describe what the daemon
 * actually sends.
 */
export type RailGroup = Omit<BufferGroup, 'kind'> & { kind: BufferGroup['kind'] | 'pinned' }

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
  return group.kind === 'dms' || group.kind === 'pinned'
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
  // Direct messages, then pinned. Stated as a rule rather than left to the
  // position numbers, which are the backend's business and were never meant
  // to encode this.
  const leadRank = (g: RailGroup): number => (g.kind === 'dms' ? 0 : 1)
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
 * The order to persist after dragging `draggedId` onto `targetId`.
 *
 * Returns the full sequence of movable entries rather than a sparse edit, so
 * the saved order stays meaningful even as guilds come and go.
 */
export function reorder(groups: RailGroup[], draggedId: string, targetId: string): string[] {
  const movable = groups.filter((g) => !isFixedEntry(g)).map((g) => g.id)
  const from = movable.indexOf(draggedId)
  const to = movable.indexOf(targetId)
  if (from === -1 || to === -1 || from === to) return movable
  movable.splice(to, 0, movable.splice(from, 1)[0])
  return movable
}


/**
 * Whether a buffer is muted, directly or by its account's server buffer.
 *
 * Muting a server cascades to every channel under that account, matching how
 * muting a whole IRC network is normally all-or-nothing. Direct messages are
 * exempt, and a hidden server does not cascade - see below.
 *
 * Shared by the rail and the channel pane for the same reason the visibility
 * rule is: they disagreed before, and the rail counted unread from muted
 * buffers while the rows underneath refused to badge them - so a tile could
 * read 40 waiting with nothing beneath it to explain where.
 */
export function isMutedBuffer(
  buffer: BufferEntry,
  all: BufferEntry[],
  muted: string[],
  hidden: string[] = [],
  mutedGroups: string[] = []
): boolean {
  // An explicit mute on this buffer always stands.
  if (muted.includes(buffer.id)) return true

  // A muted server, guild or space silences everything under it. Unlike the
  // server-buffer cascade below, this one is always undoable: the rail tile is
  // always on screen, and right-clicking it is what set this in the first
  // place.
  if (buffer.groupId && mutedGroups.includes(buffer.groupId)) return true

  if (buffer.kind === 'server') return false

  // A direct message is a person addressing you, not channel traffic.
  // Silencing a network should not silence someone messaging you on it.
  if (buffer.kind === 'dm') return false

  const server = all.find((b) => b.accountId === buffer.accountId && b.kind === 'server')
  if (!server || !muted.includes(server.id)) return false

  // The cascade is only fair while its source can be reached. A hidden server
  // buffer has no row, so its mute toggle is unreachable - inheriting from it
  // would silence an entire account with no way to undo it from the UI.
  return !hidden.includes(server.id)
}

/**
 * The buffers whose unread should reach a rail tile: what the pane below it
 * would actually list. A hidden buffer has no row to click through to, and a
 * muted one deliberately does not ask for attention.
 */
export function countsTowardRail(
  buffer: BufferEntry,
  all: BufferEntry[],
  muted: string[],
  hidden: string[],
  mutedGroups: string[] = []
): boolean {
  return !hidden.includes(buffer.id) && !isMutedBuffer(buffer, all, muted, hidden, mutedGroups)
}


/**
 * A folder in the rail: several servers behind one tile.
 *
 * Entirely this client's idea. Discord has folders of its own, but they are
 * per-account and say nothing about the Matrix spaces or IRC networks sitting
 * beside them in the same column - and the point of the rail is that those all
 * live together. So a folder here can hold anything the rail can show.
 */
export interface RailFolder {
  id: string
  name: string
  /** Group ids, in the order they were put in. */
  members: string[]
}

/** What the rail draws, top to bottom: loose entries and folders, in order. */
export type RailEntry =
  | { kind: 'group'; id: string; group: RailGroup }
  | { kind: 'folder'; id: string; folder: RailFolder; members: RailGroup[] }

/**
 * Folds the ordered groups into the rail's real layout.
 *
 * A folder takes the position of its first member, so putting servers into one
 * does not also reshuffle the column - the folder appears where the topmost of
 * them already was. Members are drawn under it only while it is open.
 */
export function railEntries(
  ordered: RailGroup[],
  folders: RailFolder[],
  open: (folderId: string) => boolean
): RailEntry[] {
  const owner = new Map<string, RailFolder>()
  for (const f of folders) {
    for (const id of f.members) owner.set(id, f)
  }

  const out: RailEntry[] = []
  const placed = new Set<string>()
  for (const g of ordered) {
    const folder = owner.get(g.id)
    if (!folder) {
      out.push({ kind: 'group', id: g.id, group: g })
      continue
    }
    if (placed.has(folder.id)) continue
    placed.add(folder.id)
    // In the folder's own order, not the rail's: that order is the one the
    // person set by dropping them in.
    const members = folder.members
      .map((id) => ordered.find((x) => x.id === id))
      .filter((x): x is RailGroup => !!x)
    out.push({ kind: 'folder', id: folder.id, folder, members })
    if (open(folder.id)) {
      for (const m of members) out.push({ kind: 'group', id: m.id, group: m })
    }
  }

  // A folder with nothing in it still draws, at the foot of the column. A
  // new one is empty by definition, and a folder that only appears once it
  // has members can never be given any.
  for (const f of folders) {
    if (!placed.has(f.id)) out.push({ kind: 'folder', id: f.id, folder: f, members: [] })
  }
  return out
}

/** Puts a group in a folder, taking it out of any other. */
export function fileInFolder(folders: RailFolder[], folderId: string, groupId: string): RailFolder[] {
  return folders.map((f) => {
    if (f.id === folderId) {
      return f.members.includes(groupId) ? f : { ...f, members: [...f.members, groupId] }
    }
    return { ...f, members: f.members.filter((m) => m !== groupId) }
  })
}

/** Takes a group out of whatever folder holds it. */
export function removeFromFolders(folders: RailFolder[], groupId: string): RailFolder[] {
  return folders.map((f) => ({ ...f, members: f.members.filter((m) => m !== groupId) }))
}
