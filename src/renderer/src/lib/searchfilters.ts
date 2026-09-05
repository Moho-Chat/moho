/**
 * The filters a search box takes, as Discord's own does.
 *
 * Typed rather than picked from menus, because that is how anybody who
 * searches a Discord server already works: `from:someone has:link` is muscle
 * memory, and a client that only offered a dropdown would be slower for
 * exactly the people who search most. The menu is still there - it writes the
 * token into the box for the people who do not know the words yet.
 */
export interface ParsedSearch {
  /** What is left once the filters are taken out: the words to look for. */
  text: string
  from?: string
  mentions?: string
  in?: string
  has?: string
  /** Unix seconds, from a plain YYYY-MM-DD. */
  before?: number
  after?: number
  /** Anything typed as `word:` that is not a filter, left in the text. */
  unknown: string[]
}

/** The filters this understands, in the order the menu offers them. */
export const FILTERS = [
  { key: 'from', label: 'From a specific user', hint: 'from: user', icon: 'person' },
  { key: 'in', label: 'Sent in a specific channel', hint: 'in: channel', icon: 'tag' },
  { key: 'has', label: 'Includes a specific type of data', hint: 'has: link, embed or file', icon: 'attach_file' },
  { key: 'mentions', label: 'Mentions a specific user', hint: 'mentions: user', icon: 'alternate_email' },
  { key: 'before', label: 'Sent before a date', hint: 'before: 2026-01-31', icon: 'event' },
  { key: 'after', label: 'Sent after a date', hint: 'after: 2026-01-01', icon: 'event' }
] as const

const KNOWN = new Set<string>(FILTERS.map((f) => f.key))

/** Midnight of a plain date, in seconds, or nothing if it is not one. */
function day(text: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined
  const at = Date.parse(`${text}T00:00:00`)
  return Number.isNaN(at) ? undefined : Math.floor(at / 1000)
}

/**
 * Splits a typed query into filters and the words around them.
 *
 * A `word:` that is not a filter stays in the text rather than being dropped:
 * people search for URLs and for times of day, and "https://x" and "12:30"
 * are not badly-spelled filters.
 */
export function parseSearch(input: string): ParsedSearch {
  const out: ParsedSearch = { text: '', unknown: [] }
  const words: string[] = []
  // Quoted values hold together, so a channel or a name with a space in it
  // can still be asked for.
  for (const token of input.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []) {
    const at = token.indexOf(':')
    const key = at > 0 ? token.slice(0, at).toLowerCase() : ''
    if (!KNOWN.has(key)) {
      if (at > 0 && /^[a-z]+$/.test(key)) out.unknown.push(key)
      words.push(token)
      continue
    }
    const value = token.slice(at + 1).replace(/^"|"$/g, '')
    if (!value) continue
    if (key === 'before' || key === 'after') {
      const when = day(value)
      // A date that is not one is not a filter; leave it in the words rather
      // than searching a range nobody asked for.
      if (when === undefined) words.push(token)
      else out[key] = when
      continue
    }
    out[key as 'from' | 'in' | 'has' | 'mentions'] = value
  }
  out.text = words.join(' ')
  return out
}

/** Whether anything was actually asked for. */
export function hasQuery(parsed: ParsedSearch): boolean {
  return !!(
    parsed.text.trim() ||
    parsed.from ||
    parsed.in ||
    parsed.has ||
    parsed.mentions ||
    parsed.before ||
    parsed.after
  )
}

/**
 * Which filter the caret is in the middle of typing, for the menu to answer.
 *
 * Everything when the box is empty or the last word is bare, the matching ones
 * while a filter name is half typed - which is the moment the menu is
 * genuinely useful - and none once a value is being typed after the colon.
 */
export function suggestions(input: string): (typeof FILTERS)[number][] {
  const last = input.split(/\s+/).pop() ?? ''
  if (last.includes(':')) return []
  const partial = last.toLowerCase()
  if (!partial) return [...FILTERS]
  return FILTERS.filter((f) => f.key.startsWith(partial))
}
