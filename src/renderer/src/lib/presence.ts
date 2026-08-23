/**
 * How a person's availability is shown, in one place.
 *
 * The colours are Discord's, because that is what these states look like to
 * anyone who has used one of these clients: green for here, amber for idle,
 * red for do-not-disturb, hollow grey for away. Kept together so the buffer
 * list, the conversation header and the member list cannot drift into showing
 * the same person three different colours.
 *
 * "dnd" is understood even though moho does not offer it as a status of its
 * own: other people set it, and their dot has to be right regardless of what
 * this client lets you choose for yourself.
 */

export type Presence = 'online' | 'idle' | 'dnd' | 'offline'

export function presenceColor(status?: string): string {
  switch (status) {
    case 'online':
      return 'var(--success)'
    case 'idle':
      return 'var(--warning)'
    case 'dnd':
      return 'var(--error)'
    default:
      return 'var(--outline)'
  }
}

export function presenceLabel(status?: string): string {
  switch (status) {
    case 'online':
      return 'Online'
    case 'idle':
      return 'Idle'
    case 'dnd':
      return 'Do not disturb'
    default:
      return 'Offline'
  }
}
