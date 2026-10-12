import { Avatar } from './Avatar'
import { useChat, useStore } from '../state/hooks'
import { readFriendRequestEntry, readInviteGroupId } from '../lib/groups'
import { serviceLabel } from '../lib/util'

/**
 * A room somebody has asked you into, and the two answers to it.
 *
 * Shown where the conversation would be, because that is what is being
 * offered: the tile in the rail says one has arrived, and this says what it
 * is and who from. Both disappear together the moment it is answered - an
 * invitation is the one thing in the rail that stops existing once it has
 * been dealt with.
 */
export function InvitePanel({ groupId }: { groupId: string }): JSX.Element | null {
  if (readFriendRequestEntry(groupId)) return <FriendRequestPanel groupId={groupId} />
  return <RoomInvitePanel groupId={groupId} />
}

/**
 * Somebody who has asked to be this account's friend. Answered here, in the
 * rail's own tile for it, the way an invitation to a room is.
 */
function FriendRequestPanel({ groupId }: { groupId: string }): JSX.Element | null {
  const store = useStore()
  const requests = useChat((s) => s.friendRequests)
  const accounts = useChat((s) => s.accounts)
  const named = readFriendRequestEntry(groupId)
  if (!named) return null

  const request = (requests[named.accountId] || []).find((r) => r.id === named.personId)
  // Answered here or elsewhere; the tile goes with it.
  if (!request) return null

  const account = accounts.find((a) => a.id === named.accountId)
  const name = request.name || request.id
  const answer = (accept: boolean): void => {
    store.answerFriendRequest(named.accountId, named.personId, accept)
    if (account) store.selectGroup(`account:${account.id}`)
  }

  return (
    <div className="invite-panel">
      <Avatar name={name} url={request.avatarUrl ?? undefined} size={64} />
      <h2 className="invite-panel-name ellipsis">{name}</h2>
      <p className="small muted">
        wants to be your friend
        {account ? ` on ${serviceLabel(account.service)} · ${account.displayName || account.id}` : ''}
      </p>
      <div className="button-row">
        <button type="button" className="button primary" onClick={() => answer(true)}>
          Accept
        </button>
        <button type="button" className="button subtle" onClick={() => answer(false)}>
          Decline
        </button>
      </div>
      <p className="small muted invite-panel-note">
        Accepting makes you friends: they appear in your direct messages and can see when you are
        online. Declining removes the request.
      </p>
    </div>
  )
}

function RoomInvitePanel({ groupId }: { groupId: string }): JSX.Element | null {
  const store = useStore()
  const invites = useChat((s) => s.matrixInvites)
  const accounts = useChat((s) => s.accounts)
  const named = readInviteGroupId(groupId)
  if (!named) return null

  const invite = (invites[named.accountId] || []).find((i) => i.roomId === named.roomId)
  // Answered, here or in another client. The tile goes with it, so this is
  // only ever seen for the moment between the two.
  if (!invite) return null

  const account = accounts.find((a) => a.id === named.accountId)
  const answer = (accept: boolean): void => {
    store.answerMatrixInvite(named.accountId, named.roomId, accept)
    // Back to the account the invitation was for: accepting puts the room in
    // its list a moment later, and declining leaves nothing to look at here.
    if (account) store.selectGroup(`account:${account.id}`)
  }

  return (
    <div className="invite-panel">
      <Avatar name={invite.name} url={invite.avatarUrl ?? undefined} size={64} />
      <h2 className="invite-panel-name ellipsis">{invite.name}</h2>
      <p className="small muted">
        {invite.inviter ? `${invite.inviter} invited you` : 'You have been invited'}
        {invite.isDirect ? ' to a direct message' : ' to this room'}
        {account ? ` · ${account.displayName || account.id}` : ''}
      </p>
      <div className="button-row">
        <button type="button" className="button primary" onClick={() => answer(true)}>
          Accept
        </button>
        <button type="button" className="button subtle" onClick={() => answer(false)}>
          Decline
        </button>
      </div>
      <p className="small muted invite-panel-note">
        Accepting joins the room and starts syncing it. Declining leaves it, and the invitation
        goes away for good.
      </p>
    </div>
  )
}
