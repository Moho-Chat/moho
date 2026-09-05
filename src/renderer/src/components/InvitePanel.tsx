import { Avatar } from './Avatar'
import { useChat, useStore } from '../state/hooks'
import { readInviteGroupId } from '../lib/groups'

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
        <button type="button" className="button danger" onClick={() => answer(false)}>
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
