import type { Account, Buffer } from '../../../shared/wire'

/**
 * Whether a conversation is actually receiving, and if not, why.
 *
 * Two places can say no. The account: every conversation under an account
 * that is not connected is not either. And the conversation itself, where it
 * has a connection of its own or a join of its own to fail - a Sneedchat room,
 * an IRC channel that refused us, a Kick channel Kick has not answered for -
 * which the daemon reports as the buffer's `link`.
 */
export interface LinkState {
  /** Something is trying: drawn with a spinner. */
  retrying: boolean
  /** What to say in the banner. */
  detail: string
  /** Which part is down, where the daemon knows: tor, site, chat, refused. */
  cause?: string
}

/** Causes the daemon keeps retrying on its own. */
const RETRIED = new Set(['tor', 'site', 'chat'])

export function bufferLink(buffer: Buffer, account: Account | undefined, accountDetail?: string): LinkState | null {
  if (account && account.state !== 'connected') {
    switch (account.state) {
      case 'connecting':
        return { retrying: true, detail: accountDetail || `Connecting to ${account.displayName}…` }
      case 'auth_failed':
        return { retrying: false, detail: `${account.displayName} needs signing in again - see Accounts.`, cause: 'refused' }
      default:
        return { retrying: false, detail: `${account.displayName} is disconnected.` }
    }
  }
  const link = buffer.link
  if (!link) return null
  if (link.state === 'connecting') return { retrying: true, detail: link.detail || 'Connecting…', cause: link.cause }
  return {
    retrying: RETRIED.has(link.cause ?? ''),
    detail: link.detail || 'Not connected.',
    cause: link.cause
  }
}

/**
 * Whether a rail entry is still connecting, for the spinner over its badge.
 *
 * An entry that belongs to one account follows that account - and also any
 * of its own conversations that are retrying on their own, which is a
 * Sneedchat room whose chat is down or a Kick channel Kick has not answered
 * for. The direct-messages entry spans accounts, so it spins while any of the
 * conversations in it would.
 */
export function railConnecting(
  group: { id: string; kind: string; accountId?: string },
  buffers: Buffer[],
  accounts: Account[],
  details: Record<string, string>
): boolean {
  const accountOf = (id: string): Account | undefined => accounts.find((a) => a.id === id)
  const retrying = (b: Buffer): boolean => bufferLink(b, accountOf(b.accountId), details[b.accountId])?.retrying === true
  if (group.kind === 'dms') return buffers.some((b) => b.kind === 'dm' && retrying(b))
  if (group.kind === 'pinned' || group.kind === 'invite' || !group.accountId) return false
  const account = accountOf(group.accountId)
  if (account && account.state === 'connecting') return true
  return buffers.some((b) => b.groupId === group.id && retrying(b))
}
