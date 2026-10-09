import { bufferDisplayName, guildOf } from './util'

/** What the quick switcher needs of a conversation, and of where it lives. */
export interface SwitcherBuffer {
  id: string
  kind: string
  name: string
  unread: number
  highlight: boolean
  lastActivityTs: number
}

export interface SwitcherHit<B extends SwitcherBuffer> {
  buffer: B
  /** The conversation's own name, without a leading # - what is searched first. */
  title: string
  /** Where it lives: a server, or the account - what is searched second. */
  where: string
  score: number
}

const MAX_HITS = 50

/** Every character of `needle` in `hay`, in order. */
function subsequence(hay: string, needle: string): boolean {
  let at = 0
  for (const ch of needle) {
    at = hay.indexOf(ch, at)
    if (at < 0) return false
    at++
  }
  return true
}

/** How well one word of the query matches a title; 0 is not at all. */
function wordScore(title: string, word: string): number {
  if (title === word) return 120
  if (title.startsWith(word)) return 100
  // At the start of a word inside it: "dev" in "moho-dev", "eagle" in "the eagles nest".
  if (new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(title)) return 80
  if (title.includes(word)) return 60
  if (subsequence(title, word)) return 30
  return 0
}

/**
 * The conversations to offer for what was typed.
 *
 * With nothing typed, what is waiting comes first (mentions, then unread),
 * then whatever was active most recently - which is what somebody pressing the
 * key with nothing in mind is after. With words typed, every word has to match
 * the name or the place, names count for more than places, and anything
 * waiting breaks a tie.
 */
export function rankBuffers<B extends SwitcherBuffer>(
  buffers: B[],
  query: string,
  whereOf: (b: B) => string
): SwitcherHit<B>[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const hits: SwitcherHit<B>[] = []
  for (const buffer of buffers) {
    if (buffer.kind === 'server') continue
    const title = bufferDisplayName(buffer.name).replace(/^#/, '')
    const where = whereOf(buffer)
    const waiting = (buffer.highlight ? 8 : 0) + (buffer.unread > 0 ? 5 : 0)
    if (words.length === 0) {
      hits.push({ buffer, title, where, score: waiting * 1e12 + buffer.lastActivityTs })
      continue
    }
    const t = title.toLowerCase()
    const w = where.toLowerCase()
    let total = 0
    let all = true
    for (const word of words) {
      const inTitle = wordScore(t, word)
      const inWhere = inTitle > 0 ? 0 : Math.min(10, wordScore(w, word) / 10)
      if (inTitle === 0 && inWhere === 0) {
        all = false
        break
      }
      total += inTitle || inWhere
    }
    if (all) hits.push({ buffer, title, where, score: total + waiting + buffer.lastActivityTs / 1e12 })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, MAX_HITS)
}

/** The place a conversation lives, for showing beside its name. */
export function whereText(
  buffer: { kind: string; name: string; accountId: string },
  accountName: (accountId: string) => string
): string {
  const guild = guildOf(buffer.name)
  if (guild) return guild
  return buffer.kind === 'dm' ? `Direct message · ${accountName(buffer.accountId)}` : accountName(buffer.accountId)
}
