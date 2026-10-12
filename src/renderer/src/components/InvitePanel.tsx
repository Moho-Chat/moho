import { Avatar } from './Avatar'
import { useChat, useStore } from '../state/hooks'
import { currentInvitation, listInvitations } from '../lib/invitations'
import { serviceLabel } from '../lib/util'

/**
 * The invitation being looked at, and the two answers to it.
 *
 * Shown where the conversation would be, because that is what is being
 * offered: the list on the left says which have arrived, and this says what
 * the chosen one is and who from. Accepting turns this pane into the
 * conversation it was offering; declining takes the invitation away. Either
 * way it disappears from the list - an invitation is the one thing here that
 * stops existing once it has been dealt with.
 */
export function InvitePanel(): JSX.Element | null {
  const store = useStore()
  const rooms = useChat((s) => s.matrixInvites)
  const friends = useChat((s) => s.friendRequests)
  const accounts = useChat((s) => s.accounts)
  const key = useChat((s) => s.activeInvitationKey)
  const invitation = currentInvitation(listInvitations(rooms, friends, accounts), key)
  // Answered, here or in another client. The page leaves with the last one.
  if (!invitation) return null

  const account = accounts.find((a) => a.id === invitation.accountId)
  const answer = (accept: boolean): void => void store.answerInvitation(invitation, accept)

  return (
    <div className="invite-panel">
      <Avatar name={invitation.name} url={invitation.avatarUrl ?? undefined} size={64} />
      <h2 className="invite-panel-name ellipsis">{invitation.name}</h2>
      <p className="small muted">
        {invitation.detail}
        {account ? ` · ${serviceLabel(account.service)} · ${account.displayName || account.id}` : ''}
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
        {invitation.kind === 'friend'
          ? 'Accepting makes you friends: the conversation with them opens here, and they can see when you are online. Declining removes the request.'
          : invitation.direct
            ? 'Accepting starts the conversation and opens it here. Declining leaves it, and the invitation goes away for good.'
            : 'Accepting joins the room and starts syncing it. Declining leaves it, and the invitation goes away for good.'}
      </p>
    </div>
  )
}
