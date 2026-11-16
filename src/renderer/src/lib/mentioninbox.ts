import type { Message } from '../../../shared/wire'

/**
 * Which mentions are still waiting, decided in one place so the button in the
 * header, its list and the page all count the same ones (#339).
 *
 * A mention stops waiting when its conversation has been read since, when the
 * inbox was emptied after it came, or when it was ticked off by itself.
 */
export interface MentionMarks {
  /** When each conversation was last read, in seconds. */
  lastRead: Record<string, number>
  /** When "Mark all read" was last pressed, in seconds. */
  emptiedTs: number
  /** The ones ticked off one at a time. */
  read: string[]
}

export function isUnreadMention(m: Pick<Message, 'id' | 'ts' | 'bufferId'>, marks: MentionMarks): boolean {
  return m.ts > marks.emptiedTs && m.ts > (marks.lastRead[m.bufferId] ?? 0) && !marks.read.includes(m.id)
}

/** How many ticked-off mentions are remembered: enough to outlast the list they are ticked off. */
const READ_KEPT = 500

export function withRead(read: string[], id: string): string[] {
  return read.includes(id) ? read : [...read, id].slice(-READ_KEPT)
}

/** A list in runs that share a place, in the order the places first appear. */
export function byPlace<T>(items: T[], placeOf: (item: T) => string): { place: string; items: T[] }[] {
  const runs: { place: string; items: T[] }[] = []
  for (const item of items) {
    const place = placeOf(item)
    const run = runs.find((r) => r.place === place)
    if (run) run.items.push(item)
    else runs.push({ place, items: [item] })
  }
  return runs
}
