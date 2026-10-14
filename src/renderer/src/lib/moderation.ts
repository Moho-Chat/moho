import type { ChatMessage } from '../state/store'

/**
 * What to do with a message the service has taken down. The daemon keeps the
 * text and says it is gone; this is the window's say in how that looks.
 */
export type RemovedMessages = 'remove' | 'strike' | 'replace'

export const REMOVED_NOTICE = 'This message was removed by moderation'

/** What a removed message says it was removed for, for a tooltip. */
export function removedReason(m: ChatMessage): string {
  const rules = m.moderated?.rules ?? []
  const by = m.moderated?.ai ? "Removed by Kick's automatic moderation" : 'Removed'
  return rules.length > 0 ? `${by}: ${rules.join(', ')}` : by
}

/**
 * The messages to draw, with those that were removed handled as chosen:
 * left out, kept as they were (the row draws them struck through), or with
 * what they said swapped for a notice. A list with none removed comes back
 * as it was, so nothing downstream re-renders for a setting it does not use.
 */
export function applyRemoved(messages: ChatMessage[], mode: RemovedMessages): ChatMessage[] {
  if (mode === 'strike' || !messages.some((m) => m.moderated)) return messages
  if (mode === 'remove') return messages.filter((m) => !m.moderated)
  return messages.map((m) =>
    m.moderated
      ? { ...m, body: REMOVED_NOTICE, html: undefined, embeds: [], attachments: [], components: [], moderated: { ...m.moderated, replaced: true } }
      : m
  )
}
