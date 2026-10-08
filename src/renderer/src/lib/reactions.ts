/**
 * What to call a reaction, and who to say gave it.
 */

/**
 * The name to show for a reaction's emoji. A custom one carries its own, in
 * the token it is stored as (`<:name:id>`, or `<a:name:id>` when it moves); a
 * Unicode one is looked up, and with no name to give is shown as itself.
 */
export function reactionLabel(emoji: string, unicodeNames: ReadonlyMap<string, string> = new Map()): string {
  const custom = emoji.match(/^<a?:([A-Za-z0-9_~]{2,32}):\d+>$/)
  if (custom) return `:${custom[1]}:`
  const name = unicodeNames.get(emoji)
  return name ? `:${name}:` : emoji
}

/**
 * The sentence for the tooltip over a reaction, as Discord words it: who, up
 * to three by name, and how many more. Where nobody is named - not asked yet,
 * or the service cannot say - it says how many, and no more.
 */
export function reactorsSentence(label: string, names: string[], total: number): string {
  const shown = names.slice(0, 3)
  if (shown.length === 0) {
    return `${total} ${total === 1 ? 'person' : 'people'} reacted with ${label}`
  }
  const rest = Math.max(0, total - shown.length)
  if (rest > 0) return `${shown.join(', ')} and ${rest} ${rest === 1 ? 'other' : 'others'} reacted with ${label}`
  if (shown.length === 1) return `${shown[0]} reacted with ${label}`
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]} reacted with ${label}`
}
