/**
 * Tagging somebody, in whichever protocol's terms.
 *
 * Every service here has the idea and none of them spell it the same way:
 * Discord pings on an id and treats a typed name as text, Matrix carries a
 * list of who was meant, IRC has no mentions at all and highlights on a nick
 * appearing anywhere in a line. What they share is the gesture - "@" and the
 * start of a name - so that is what this describes, and the differences are
 * kept here rather than in the composer.
 */

export interface MentionKeyword {
  /** What is typed, without the "@". */
  word: string
  /** What it does, in the service's own terms. */
  detail: string
}

/**
 * The whole-room mentions a service understands.
 *
 * Only where the service actually acts on them: offering "@everyone" on IRC
 * would be offering a phrase that notifies nobody and looks like it did.
 */
export function mentionKeywords(service: string | undefined): MentionKeyword[] {
  switch (service) {
    case 'discord':
      return [
        { word: 'everyone', detail: 'Notify everyone in this channel' },
        { word: 'here', detail: 'Notify everyone who is online' }
      ]
    case 'matrix':
      return [{ word: 'room', detail: 'Notify everyone in this room' }]
    case 'sneedchat':
      return [{ word: 'everyone', detail: 'Notify everyone in this room' }]
    // Kick has no whole-chat mention, and IRC has no mentions at all - a nick
    // highlights because it appears in the line, not because of the "@".
    default:
      return []
  }
}

/**
 * What to put in the box when a name is chosen.
 *
 * IRC addresses somebody at the start of a line with "nick: " and nowhere
 * else - the "@" is not part of how IRC talks, and leaving one in would put a
 * character in the message that means nothing to anyone reading it. Everywhere
 * else keeps the "@", which is both what people expect to see and, for
 * Discord, what the daemon turns into a real ping on the way out.
 */
export function mentionInsert(service: string | undefined, name: string, atLineStart: boolean): string {
  if (service === 'irc') return atLineStart ? `${name}: ` : `${name} `
  return `@${name} `
}

/**
 * The mention being typed at the caret, or null.
 *
 * The "@" has to start a word, so an email address is not a mention. An empty
 * query counts: typing "@" alone is somebody asking who is here, which is
 * exactly when the list is most useful.
 */
export function mentionQuery(before: string): string | null {
  const match = before.match(/(?:^|[\s(])@([^\s@]*)$/)
  return match ? match[1] : null
}

/**
 * How well a candidate matches what has been typed, or 0 for not at all.
 *
 * Fuzzy rather than prefix, because names here are long and full of things
 * nobody types in order - "***GAYMER WORD USER***", "Temu Blue Belt" - and a
 * prefix match makes somebody type the punctuation. The letters must appear
 * in order, which is what keeps the list from filling with everybody.
 *
 * Scoring, highest first: a prefix beats a word start, which beats a match
 * anywhere; a run of adjacent letters beats a scattered one; and a shorter
 * name beats a longer one where all else is equal, since the short one is
 * more likely the thing being aimed at.
 */
export function fuzzyScore(candidate: string, query: string): number {
  if (!query) return 1
  const name = candidate.toLowerCase()
  const q = query.toLowerCase()

  if (name.startsWith(q)) return 1000 - name.length
  const wordStart = name.split(/[\s_\-.*]+/).some((word) => word.startsWith(q))
  let score = wordStart ? 700 - name.length : 0

  // Subsequence: every letter of the query, in order, somewhere in the name.
  let at = -1
  let run = 0
  let best = 0
  for (const letter of q) {
    const found = name.indexOf(letter, at + 1)
    if (found === -1) return score > 0 ? score : 0
    run = found === at + 1 ? run + 1 : 1
    best = Math.max(best, run)
    at = found
  }
  return Math.max(score, 300 + best * 10 - name.length)
}

/** One thing that can be tagged: a person, a role, or a whole-room keyword. */
export interface MentionTarget {
  /** What is inserted, without the "@". */
  name: string
  /** Shown to the right - a handle, or what a keyword does. */
  detail?: string
  /** Roles carry their own colour, which is how people recognise them. */
  colour?: string
  kind: 'member' | 'role' | 'keyword'
  /** Members only, for the picture. */
  userId?: string
}

/** The targets that match, best first. */
export function rankMentions(targets: MentionTarget[], query: string, limit = 8): MentionTarget[] {
  return targets
    .map((target) => ({ target, score: fuzzyScore(target.name, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ target }) => target)
}
