import type { Buffer as WireBuffer } from '../../../shared/wire'

/**
 * How much a conversation may interrupt: the four settings every service
 * either has or can be given.
 *
 * Element offers exactly these for a room, and Discord, Stoat and Steam have
 * the same under other names - so the window asks one question and the
 * services differ only in which of the four they can honour.
 */
export type NotifyLevel = 'default' | 'all' | 'mentions' | 'mute'

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
  return ['matrix:', 'discord:', 'stoat:', 'steam:', 'telegram:'].some((prefix) => accountId.startsWith(prefix))
}

/**
 * Which of the four a conversation can be set to.
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
      return buffer.kind === 'dm' ? ['default', 'mute'] : ['all', 'mentions', 'mute']
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
    case 'mute':
      return 'notifications_off'
  }
}
