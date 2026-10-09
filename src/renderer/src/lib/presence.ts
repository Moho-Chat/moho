/**
 * How a person's availability is shown, in one place.
 *
 * The colours are Discord's, because that is what these states look like to
 * anyone who has used one of these clients: green for here, amber for idle,
 * red for do-not-disturb, a hollow grey ring for away or gone. Kept together
 * so the buffer list, the conversation header, the member list and the server
 * header's connection dot cannot drift into showing the same state three
 * different ways - which they had: do-not-disturb was a pale pink, "away" was
 * a solid grey nobody could tell from a missing picture, and a connection that
 * was still being made was labelled Offline.
 *
 * "dnd" is understood even though moho does not offer it as a status of its
 * own: other people set it, and their dot has to be right regardless of what
 * this client lets you choose for yourself.
 */

export type Presence = 'online' | 'idle' | 'dnd' | 'connecting' | 'offline'

/** Which of the five a service's word for it is. Anything unknown is offline. */
export function presenceKind(status?: string): Presence {
  switch (status) {
    case 'online':
    case 'connected':
      return 'online'
    case 'idle':
      return 'idle'
    case 'dnd':
      return 'dnd'
    case 'connecting':
      return 'connecting'
    default:
      return 'offline'
  }
}

/**
 * The class that draws the dot. The colours live in the stylesheet, beside
 * the ring that keeps a dot legible over a picture, rather than being handed
 * to each dot as a style - which is what lets "offline" be hollow.
 */
export function presenceClass(status?: string): string {
  return `presence-${presenceKind(status)}`
}

export function presenceColor(status?: string): string {
  switch (presenceKind(status)) {
    case 'online':
      return 'var(--success)'
    case 'idle':
      return 'var(--warning)'
    case 'dnd':
      return 'var(--danger)'
    default:
      return 'var(--outline)'
  }
}

export function presenceLabel(status?: string): string {
  switch (presenceKind(status)) {
    case 'online':
      return 'Online'
    case 'idle':
      return 'Idle'
    case 'dnd':
      return 'Do not disturb'
    case 'connecting':
      return 'Connecting…'
    default:
      return 'Offline'
  }
}
