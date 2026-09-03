/**
 * Completing a name from what has been typed so far.
 *
 * Kept apart from the composer because the rule is the interesting part and
 * the DOM is not: what counts as the word being completed, what happens when
 * several people match, and what a completed name is followed by.
 */

export interface Completion {
  /** How many characters before the caret to replace. */
  replace: number
  /** What to put there, including whatever should follow the name. */
  insert: string
  /** The bare name chosen, so a caller can remember where it got to. */
  nick: string
}

/**
 * The next completion for the word ending at the end of `before`.
 *
 * `attempt` cycles: pressing Tab again offers the next match rather than the
 * same one, which is the behaviour every IRC client has and the reason this
 * takes an index at all.
 *
 * A name completed at the very start of the line is followed by ": ", because
 * that is how somebody is addressed; anywhere else it is a plain space, since
 * mid-sentence a colon is punctuation nobody wants.
 *
 * Matching is case-insensitive but the completion keeps the roster's own
 * capitalisation - `jd` completes to `JDog`, not `jdog`, because a nick's
 * case is part of it and getting it wrong is how a highlight fails to fire.
 */
export function completeNick(before: string, nicks: string[], attempt: number): Completion | null {
  const word = before.match(/(\S+)$/)?.[1]
  if (!word) return null

  const lower = word.toLowerCase()
  const matches = nicks.filter((n) => n.toLowerCase().startsWith(lower))
  if (matches.length === 0) return null

  const nick = matches[attempt % matches.length]
  const atStart = before.length === word.length
  return { replace: word.length, insert: nick + (atStart ? ': ' : ' '), nick }
}

/**
 * The word a cycling completion should keep matching against.
 *
 * After the first Tab the text before the caret ends in a completed name, not
 * in what was typed - so a second Tab has to remember the original prefix or
 * it would start completing the completion. Returns null when the text is not
 * the result of the completion it was given, which is how typing anything
 * cancels the cycle.
 */
export function cyclePrefix(before: string, last: Completion | null): string | null {
  if (!last) return null
  const ending = last.insert
  return before.endsWith(ending) ? before.slice(0, -ending.length) : null
}
