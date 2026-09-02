import type { BufferEntry } from '../state/store'

/**
 * Headings in the channel list, and which channels sit under them.
 *
 * Two kinds, deliberately kept in one list. A service that organises its own
 * channels - Discord, with its categories - supplies headings that appear
 * without anyone asking, and a person can add their own on top. The second
 * kind wins where they disagree: a heading you made yourself is a decision,
 * and a server rearranging its categories should not quietly undo it.
 */

/** A heading a person created, stored per rail entry. */
export interface CustomCategory {
  id: string
  name: string
}

export interface CategorySection {
  /** Stable across renames, so collapse state survives one. */
  key: string
  /** Absent for the channels that sit above every heading. */
  name?: string
  /** Whether this heading is the user's rather than the service's. */
  custom: boolean
  buffers: BufferEntry[]
}

/**
 * The unheaded section, which holds the channels that sit above every heading.
 *
 * Never reordered and never dragged: it has no heading to take hold of, and
 * "the ones under nothing" only means anything at the top.
 */
export const LOOSE_KEY = '~loose'

/** The key a collapse state is stored under. */
export function categoryKey(groupId: string, section: { key: string }): string {
  return `${groupId}|${section.key}`
}

/**
 * Splits a group's channels into headed sections.
 *
 * Channels under no heading come first and unnamed, which is where Discord
 * shows its uncategorised channels and where anything from a service with no
 * categories at all belongs - the whole list, under nothing.
 */
export function sections(
  buffers: BufferEntry[],
  custom: CustomCategory[],
  assignment: Record<string, string>,
  /**
   * The order somebody dragged these into, by key. Partial by nature: a
   * heading the service added since is not in it, and lands after the ones
   * that are rather than somewhere arbitrary among them.
   */
  order: string[] = []
): CategorySection[] {
  const loose: BufferEntry[] = []
  const byCustom = new Map<string, BufferEntry[]>(custom.map((c) => [c.id, []]))
  const byService = new Map<string, BufferEntry[]>()

  for (const b of buffers) {
    const mine = assignment[b.id]
    // An assignment to a category since deleted falls back to the service's
    // own answer rather than vanishing into a heading that is not drawn.
    if (mine && byCustom.has(mine)) {
      byCustom.get(mine)!.push(b)
      continue
    }
    if (b.category) {
      if (!byService.has(b.category)) byService.set(b.category, [])
      byService.get(b.category)!.push(b)
      continue
    }
    loose.push(b)
  }

  const out: CategorySection[] = []
  if (loose.length) out.push({ key: '~loose', custom: false, buffers: loose })
  // A person's own headings sit above the service's: they were made
  // deliberately, and burying them under a server's twenty categories would
  // defeat the point of making them.
  for (const c of custom) {
    out.push({ key: c.id, name: c.name, custom: true, buffers: byCustom.get(c.id) ?? [] })
  }
  for (const [name, list] of byService) {
    out.push({ key: `svc:${name}`, name, custom: false, buffers: list })
  }
  return applyOrder(out, order)
}

/**
 * Puts the sections in the order somebody chose, as far as that order goes.
 *
 * Named keys first in the order they were named, then everything else in the
 * order it would have had anyway. A dragged list is saved whole, so the second
 * half is empty until a heading appears that nobody has placed yet - a new
 * Discord category, or a heading just created - and one of those arriving at
 * the end is both predictable and easy to undo by dragging it.
 *
 * The unheaded section is exempt and stays first whatever the order says.
 */
function applyOrder(list: CategorySection[], order: string[]): CategorySection[] {
  if (order.length === 0) return list
  const rank = new Map(order.map((key, i) => [key, i]))
  const loose = list.filter((s) => s.key === LOOSE_KEY)
  const rest = list.filter((s) => s.key !== LOOSE_KEY)
  const placed = order.map((key) => rest.find((s) => s.key === key)).filter((s): s is CategorySection => !!s)
  const unplaced = rest.filter((s) => !rank.has(s.key))
  return [...loose, ...placed, ...unplaced]
}

/**
 * The order to save after dragging one heading onto another.
 *
 * The same rule the server rail uses, and for the same reason: the dragged
 * thing takes the target's place, and whatever was there shuffles aside in
 * the direction the drag came from. Dropping onto the last heading therefore
 * means "put it last", which is the gesture people try first and the one the
 * rail had to grow a separate drop zone for.
 */
export function reorderCategories(
  list: CategorySection[],
  draggedKey: string,
  targetKey: string
): string[] {
  const keys = list.filter((s) => s.key !== LOOSE_KEY).map((s) => s.key)
  const from = keys.indexOf(draggedKey)
  const to = keys.indexOf(targetKey)
  if (from === -1 || to === -1 || from === to) return keys
  keys.splice(to, 0, keys.splice(from, 1)[0])
  return keys
}
