/**
 * Hiding a picture or a video behind a spoiler after it has been sent.
 *
 * Two different things share the word. A spoiler the sender made is part of the message (a file named `SPOILER_...`). One
 * made here is this person's own wish not to see something - an NSFW picture somebody posted - and is kept on this
 * computer, per picture, and touches nobody else.
 */

/** What names one picture in one message, for the list of the ones hidden here. Absent where the message has no id yet. */
export function mediaKey(messageId: string | undefined, name: string | undefined): string | null {
  if (!messageId || !name) return null
  return `${messageId}|${name}`
}
