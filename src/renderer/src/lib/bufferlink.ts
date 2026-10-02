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
