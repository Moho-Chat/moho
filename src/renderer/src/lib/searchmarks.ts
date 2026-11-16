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
