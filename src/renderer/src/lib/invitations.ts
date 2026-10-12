import type { Account, FriendRequest, MatrixInvite } from '../../../shared/wire'

/**
 * Something waiting on an answer from you: a room somebody invited you to, or
 * somebody asking to be your friend. Every service's are one list, because what
 * they share is that they are offered, answered once, and then gone - not which
 * protocol they came by.
 */
export interface Invitation {
  /** Unique across accounts and kinds; what selection is by. */
  key: string
  accountId: string
  service: string
  kind: 'room' | 'friend'
  /** The service's own id: a room id, or the person's id. */
  id: string
  name: string
  avatarUrl: string | null
  /** Who is asking, and for what, in a few words. */
  detail: string
  /** Whether accepting makes a conversation with one person. */
  direct: boolean
}

export function invitationKey(accountId: string, kind: 'room' | 'friend', id: string): string {
  return `${kind}|${accountId}|${id}`
}

/**
 * Every pending invitation, across accounts, in the order the accounts are
 * listed and each account's own order within. Requests for an account that is
 * no longer there are dropped rather than shown with nobody to answer as.
 */
export function listInvitations(
  rooms: Record<string, MatrixInvite[]>,
  friends: Record<string, FriendRequest[]>,
  accounts: Account[]
): Invitation[] {
  const out: Invitation[] = []
  for (const account of accounts) {
    for (const invite of rooms[account.id] ?? []) {
      out.push({
        key: invitationKey(account.id, 'room', invite.roomId),
        accountId: account.id,
        service: account.service,
        kind: 'room',
        id: invite.roomId,
        name: invite.name,
        avatarUrl: invite.avatarUrl,
        detail: `${invite.inviter ? `${invite.inviter} invited you` : 'You have been invited'}${invite.isDirect ? ' to a direct message' : ' to this room'}`,
        direct: invite.isDirect
      })
    }
    for (const request of friends[account.id] ?? []) {
      const name = request.name || request.id
      out.push({
        key: invitationKey(account.id, 'friend', request.id),
        accountId: account.id,
        service: account.service,
        kind: 'friend',
        id: request.id,
        name,
        avatarUrl: request.avatarUrl ?? null,
        detail: 'wants to be your friend',
        direct: true
      })
    }
  }
  return out
}

/** The one being looked at: the one chosen, or the first when none is or it has gone. */
export function currentInvitation(list: Invitation[], key: string): Invitation | undefined {
  return list.find((i) => i.key === key) ?? list[0]
}
