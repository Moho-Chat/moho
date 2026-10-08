import { fuzzyScore } from './mentions'

/**
 * ":fire" turning into the emoji, while it is typed - the second kind of
 * thing the box completes beside "@name" and "/command".
 */

/** One thing a typed ":word" can become. */
export interface ShortcodeTarget {
  /** What is typed to find it, without the colons. */
  name: string
  /** Other words that find it: "fire" is also "lit" and "hot". */
  aliases: string[]
  /** What goes in the message: the character, or the service's own token. */
  token: string
  /** A character to show, where there is no picture. */
  glyph?: string
}

/**
 * The ":word" being typed at the caret, or null.
 *
 * It has to start a word, so a time ("10:30") and a link ("https://") are not
 * one, and it takes at least two letters, so ":)" and ":P" stay faces rather
 * than opening a list nobody asked for.
 */
export function shortcodeQuery(before: string): string | null {
  const match = before.match(/(?:^|[\s(]):([A-Za-z0-9_+~-]{2,})$/)
  return match ? match[1] : null
}

/** The curated Unicode set, as shortcodes: its first word is the name, the rest find it. */
export function unicodeTargets(list: { emoji: string; name: string }[]): ShortcodeTarget[] {
  return list.map(({ emoji, name }) => {
    const [first, ...rest] = name.split(/\s+/)
    return { name: first, aliases: rest, token: emoji, glyph: emoji }
  })
}

/** The targets that match, best first: the name counts for more than a nickname of it. */
export function rankShortcodes(targets: ShortcodeTarget[], query: string, limit = 8): ShortcodeTarget[] {
  return targets
    .map((target) => {
      const byAlias = Math.max(0, ...target.aliases.map((a) => fuzzyScore(a, query) - 50))
      return { target, score: Math.max(fuzzyScore(target.name, query), byAlias) }
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ target }) => target)
}
