/**
 * Which statuses a service has, kept in step with `status_supported` in the
 * daemon, which also refuses what a service has no state for.
 *
 * Offered by what each can actually express rather than by what could be faked
 * from something nearby: Discord has all four; Steam has online, away and
 * invisible, with do not disturb moho's own as everywhere; IRC has away and back - idle and
 * online; Matrix has online and offline presence, so invisible is real and idle
 * is not; Kick and Sneedchat have none. Do not disturb is online with moho's own
 * desktop notifications silenced, which any service can have, so it is on all of
 * them - and only Discord has a real state for it, which also holds back its
 * phone notifications.
 */
export type Choosable = 'online' | 'idle' | 'focus' | 'dnd' | 'invisible'

export const ALL_STATUSES: Choosable[] = ['online', 'idle', 'focus', 'dnd', 'invisible']

export function supportsStatus(service: string, status: Choosable): boolean {
  switch (status) {
    case 'online':
    case 'dnd':
      return true
    case 'idle':
      return service === 'discord' || service === 'irc' || service === 'steam' || service === 'stoat'
    // Stoat's own: only mentions reach you.
    case 'focus':
      return service === 'stoat'
    case 'invisible':
      return service === 'discord' || service === 'matrix' || service === 'steam' || service === 'stoat'
  }
}

/** What an account of this service can be set to, in the order they are listed. */
export function statusesFor(service: string): Choosable[] {
  return ALL_STATUSES.filter((s) => supportsStatus(service, s))
}

/**
 * What a status is called on this service.
 *
 * Matrix has no invisible mode: what is sent for it is offline presence, which
 * is what it is, so that is what it says there. Everything else is called what
 * the others call it.
 */
export function statusName(service: string, status: Choosable): string {
  if (status === 'invisible' && service === 'matrix') return 'Offline'
  return { online: 'Online', idle: 'Idle', focus: 'Focus', dnd: 'Do not disturb', invisible: 'Invisible' }[status]
}
