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
  assignment: Record<string, string>
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
  return out
}
