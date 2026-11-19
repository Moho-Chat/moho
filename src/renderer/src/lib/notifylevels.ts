import type { Buffer as WireBuffer } from '../../../shared/wire'

/**
 * How much a conversation may interrupt: the settings every service either
 * has or can be given.
 *
 * Element offers four of these for a room, and Discord, Stoat and Steam have
 * the same under other names - so the window asks one question and the
 * services differ only in which they can honour.
 *
 * The fifth, 'direct', is the daemon's own (#339): mentions only, without
 * what is aimed at everybody - `@everyone`, `@here`, `@room`, `@all`. For a
 * channel where those are used to get attention nobody asked to give, and
 * where somebody may still have something to say to you by name. No service
 * keeps it, so the daemon does, on top of the service's own mentions-only.
 */
export type NotifyLevel = 'default' | 'all' | 'mentions' | 'direct' | 'mute'

/** What a conversation is set to. The daemon leaves the default out. */
export function levelOf(buffer: Pick<WireBuffer, 'notify' | 'notifyApplied'>): NotifyLevel {
  return buffer.notify ?? 'default'
}

/** What actually applies to it, which differs only where its server speaks for it. */
export function appliedLevelOf(buffer: Pick<WireBuffer, 'notify' | 'notifyApplied'>): NotifyLevel {
  return buffer.notifyApplied ?? levelOf(buffer)
}

/**
 * Whether the account itself keeps a conversation's level.
 *
 * The same list as the daemon's `held_on_account`, and for the same reason it
 * matters here: for these services the account is the truth, so a copy of a
 * mute kept in this window can only ever be stale.
 */
export function heldOnAccount(accountId: string): boolean {
  return ['matrix:', 'discord:', 'stoat:', 'fluxer:', 'steam:', 'telegram:'].some((prefix) => accountId.startsWith(prefix))
}

/**
 * Which of them a conversation can be set to.
 *
 * Only what the service can actually keep. A service that holds the setting on
 * the account offers what the account can hold: Telegram keeps "muted until"
 * and nothing between, and a menu that offered "mentions only" there would be
 * promising a setting that would quietly turn into something else. Steam keeps
 * the three for a group's rooms and has no default to leave one on, and for a
 * friend keeps only whether their messages notify at all.
 *
 * Everything else has no setting of its own, so the daemon keeps one - all four.
 */
export function notifyLevelsFor(service: string | undefined, buffer: Pick<WireBuffer, 'kind'>): NotifyLevel[] {
  switch (service) {
    case 'telegram':
      return ['default', 'mute']
    case 'steam':
      return buffer.kind === 'dm' ? ['default', 'mute'] : ['all', 'mentions', 'direct', 'mute']
    // The services with a way to address a whole place - @everyone and @here,
    // @room - which is what direct mentions only leaves out. On the rest, and
    // in a conversation with one person, it would be mentions only under
    // another name, so it is not offered. The same list as the daemon's
    // `mentions_the_room`.
    case 'discord':
    case 'matrix':
    case 'sneedchat':
      return buffer.kind === 'dm' ? ['default', 'all', 'mentions', 'mute'] : ['default', 'all', 'mentions', 'direct', 'mute']
    default:
      return ['default', 'all', 'mentions', 'mute']
  }
}

/**
 * What a level is called, for a particular service and kind of conversation.
 *
 * The words are the ones the service's own client uses where it has them -
 * Element says "Mentions and keywords" and "Mute room" - because somebody who
 * set it there is looking for the same words here.
 */
export function levelLabel(level: NotifyLevel, service: string | undefined, kind: string): string {
  switch (level) {
    case 'default':
      return service === 'matrix' ? 'Match default settings' : 'Default'
    case 'all':
      return 'All messages'
    case 'mentions':
      return service === 'matrix' ? 'Mentions and keywords' : 'Mentions only'
    case 'direct':
      return 'Direct mentions only'
    case 'mute':
      return service === 'matrix' ? 'Mute room' : kind === 'dm' ? 'Mute conversation' : 'Mute channel'
  }
}

/** The icon beside it. */
export function levelIcon(level: NotifyLevel): string {
  switch (level) {
    case 'default':
      return 'notifications'
    case 'all':
      return 'notifications_active'
    case 'mentions':
      return 'alternate_email'
    case 'direct':
      return 'person'
    case 'mute':
      return 'notifications_off'
  }
}
