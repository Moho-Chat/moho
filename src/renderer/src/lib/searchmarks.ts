import type { Message } from '../../../shared/wire'

/** Comings and goings, which match a name searched for and are rarely what was being looked for. */
const ROOM_EVENT = /^(join|part|quit|nick|mode|matrix(Join|Quit|Invite|Kick))$/

export function isRoomEvent(m: Pick<Message, 'kind'>): boolean {
  return ROOM_EVENT.test(m.kind)
}

/**
 * A piece of text cut into what matched and what did not, so the match can be
 * marked. Whole words of the query, any case; nothing is marked for a query
 * that is only filters.
 */
export function markMatches(text: string, query: string): { text: string; hit: boolean }[] {
  const words = query
    .split(/\s+/)
    .filter((w) => w.length > 0 && !/^[a-z]+:/i.test(w))
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (words.length === 0) return [{ text, hit: false }]
  const pattern = new RegExp(`(${words.join('|')})`, 'gi')
  return text
    .split(pattern)
    .filter((part) => part !== '')
    .map((part, i) => ({ text: part, hit: i % 2 === 1 || new RegExp(`^(?:${words.join('|')})$`, 'i').test(part) }))
}

/** A stretch of the log that is nothing but people coming and going. */
export interface EventRun {
  /** Index of its first message, and of its last. */
  first: number
  last: number
  joined: number
  left: number
  other: number
}

/** How many comings and goings in a row are worth folding into one line. */
export const RUN_FOLDS_AT = 3

/**
 * The runs of comings and goings in a log long enough to fold, by the index
 * of every message in one. A run does not cross midnight: the day's divider
 * belongs between its halves.
 */
export function eventRuns(messages: Pick<Message, 'kind' | 'ts'>[], sameDay: (a: number, b: number) => boolean): Map<number, EventRun> {
  const runs = new Map<number, EventRun>()
  let i = 0
  while (i < messages.length) {
    if (!isRoomEvent(messages[i])) {
      i++
      continue
    }
    let j = i
    while (j + 1 < messages.length && isRoomEvent(messages[j + 1]) && sameDay(messages[j].ts, messages[j + 1].ts)) j++
    if (j - i + 1 >= RUN_FOLDS_AT) {
      const run: EventRun = { first: i, last: j, joined: 0, left: 0, other: 0 }
      for (let k = i; k <= j; k++) {
        const kind = messages[k].kind
        if (/join$/i.test(kind)) run.joined++
        else if (/^(part|quit|matrixQuit|matrixKick)$/.test(kind)) run.left++
        else run.other++
        runs.set(k, run)
      }
    }
    i = j + 1
  }
  return runs
}

/** "3 joined, 1 left" - a run, in as few words as say it. */
export function runSummary(run: EventRun): string {
  const parts: string[] = []
  if (run.joined) parts.push(`${run.joined} joined`)
  if (run.left) parts.push(`${run.left} left`)
  if (run.other) parts.push(`${run.other} other ${run.other === 1 ? 'change' : 'changes'}`)
  return parts.join(', ')
}
