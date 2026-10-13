import type { Account, DiscordFriend, FriendRequest, MatrixInvite, MatrixVerification } from '../../../shared/wire'

/**
 * Something waiting on a yes or a no from you: a room somebody invited you to,
 * somebody asking to be your friend, a session asking to be verified. Every
 * service's are one list, because what they share is that they are offered,
 * answered once, and then gone - not which protocol they came by.
 *
 * Anything a service asks that has exactly those two answers belongs here, and
 * not on a page of its own for that service.
 */
export interface Invitation {
  /** Unique across accounts and kinds; what selection is by. */
  key: string
  accountId: string
  service: string
  kind: InvitationKind
  /** The service's own id: a room id, or the person's id. */
  id: string
  name: string
  avatarUrl: string | null
  /** Who is asking, and for what, in a few words. */
  detail: string
  /** Whether accepting makes a conversation with one person. */
  direct: boolean
}

export type InvitationKind = 'room' | 'friend' | 'verification'

export function invitationKey(accountId: string, kind: InvitationKind, id: string): string {
  return `${kind}|${accountId}|${id}`
}

/** What is waiting, by where each service keeps it. */
export interface InvitationSources {
  /** Matrix rooms and direct messages somebody invited the account to. */
  rooms: Record<string, MatrixInvite[]>
  /** Steam's requests, by account. */
  friends: Record<string, FriendRequest[]>
  /** Discord's relationships, by account; the ones somebody sent are requests. */
  discordFriends: Record<string, DiscordFriend[]>
  /** A Matrix verification, if somebody has asked and it is not answered. */
  verification: MatrixVerification | null
}

/**
 * Every pending invitation, across accounts, in the order the accounts are
 * listed and each account's own order within. Requests for an account that is
 * no longer there are dropped rather than shown with nobody to answer as.
 */
export function listInvitations(sources: InvitationSources, accounts: Account[]): Invitation[] {
  const out: Invitation[] = []
  for (const account of accounts) {
    for (const invite of sources.rooms[account.id] ?? []) {
      out.push({
        key: invitationKey(account.id, 'room', invite.roomId),
        accountId: account.id,
        service: account.service,
        kind: 'room',
        id: invite.roomId,
        name: invite.name,
        avatarUrl: invite.avatarUrl,
        detail: `${invite.inviter ? `${invite.inviter} invited you` : 'You have been invited'}${invite.isDirect ? ' to a direct message' : account.service === 'steam' ? ' to a group chat' : ' to this room'}`,
        direct: invite.isDirect
      })
    }
    const people: { id: string; name: string; avatarUrl: string | null }[] = [
      ...(sources.friends[account.id] ?? []).map((r) => ({ id: r.id, name: r.name || r.id, avatarUrl: r.avatarUrl ?? null })),
      ...(sources.discordFriends[account.id] ?? [])
        .filter((f) => f.kind === 'incoming')
        .map((f) => ({ id: f.userId, name: f.globalName || f.username, avatarUrl: f.avatarUrl ?? null }))
    ]
    for (const person of people) {
      out.push({
        key: invitationKey(account.id, 'friend', person.id),
        accountId: account.id,
        service: account.service,
        kind: 'friend',
        ...person,
        detail: 'wants to be your friend',
        direct: true
      })
    }
    const v = sources.verification
    if (v && v.incoming && v.accountId === account.id) {
      const who = v.otherUser || v.fromUser || ''
      const mine = v.isSelf !== false
      out.push({
        key: invitationKey(account.id, 'verification', v.verificationId),
        accountId: account.id,
        service: account.service,
        kind: 'verification',
        id: v.verificationId,
        name: mine ? 'Another of your sessions' : who || 'Somebody',
        avatarUrl: null,
        detail: mine ? `wants to verify${v.otherDevice ? ` (${v.otherDevice})` : ''}` : 'wants to verify with you',
        direct: false
      })
    }
  }
  return out
}

/** The one being looked at: the one chosen, or the first when none is or it has gone. */
export function currentInvitation(list: Invitation[], key: string): Invitation | undefined {
  return list.find((i) => i.key === key) ?? list[0]
}
