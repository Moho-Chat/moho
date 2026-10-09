/**
 * Which statuses a service has, kept in step with `status_supported` in the
 * daemon, which also refuses what a service has no state for.
 *
 * Offered by what each can actually express rather than by what could be faked
 * from something nearby: Discord has all four; IRC has away and back - idle and
 * online; Matrix has online and offline presence, so invisible is real and idle
 * is not; Kick and Sneedchat have none. Do not disturb is online with moho's own
 * desktop notifications silenced, which any service can have, so it is on all of
 * them - and only Discord has a real state for it, which also holds back its
 * phone notifications.
 */
export type Choosable = 'online' | 'idle' | 'dnd' | 'invisible'

export const ALL_STATUSES: Choosable[] = ['online', 'idle', 'dnd', 'invisible']

export function supportsStatus(service: string, status: Choosable): boolean {
  switch (status) {
    case 'online':
    case 'dnd':
      return true
    case 'idle':
      return service === 'discord' || service === 'irc'
    case 'invisible':
      return service === 'discord' || service === 'matrix'
  }
}

/** What an account of this service can be set to, in the order they are listed. */
export function statusesFor(service: string): Choosable[] {
  return ALL_STATUSES.filter((s) => supportsStatus(service, s))
}
