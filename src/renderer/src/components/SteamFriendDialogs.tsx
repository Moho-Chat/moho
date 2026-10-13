import { Modal } from './Modal'
import { ReasonPrompt } from './ReasonPrompt'
import { useChat, useStore } from '../state/hooks'
import { bufferDisplayName } from '../lib/util'

/**
 * The questions about a Steam friend that want an answer before anything is
 * done: what to call them, and the two that cannot be quietly undone.
 *
 * One place, mounted once, because the menus that ask them are in two places -
 * a conversation's row and its header - and a dialog belongs to neither.
 */
export function SteamFriendDialogs(): JSX.Element | null {
  const store = useStore()
  const dialog = useChat((s) => s.steamDialog)
  const buffer = useChat((s) => s.buffers.find((b) => b.id === dialog?.bufferId))
  if (!dialog || !buffer) return null
  const name = bufferDisplayName(buffer.name)

  if (dialog.what === 'nickname') {
    return (
      <ReasonPrompt
        title={`Nickname for ${name}`}
        detail="What you call them. It is kept by Steam for your account, so it is the name on your other devices too. Leave it empty to go back to the name they chose."
        placeholder="A name for them"
        confirmLabel="Save"
        optional
        onCancel={() => store.closeSteamDialog()}
        onConfirm={(nickname) => void store.doSteamFriend('nickname', dialog.bufferId, nickname)}
      />
    )
  }

  const removing = dialog.what === 'remove'
  return (
    <Modal title={removing ? `Remove ${name}?` : `Block ${name}?`} icon="warning" iconColor="var(--warning)" onClose={() => store.closeSteamDialog()}>
      <p className="small">
        {removing
          ? `${name} will no longer be on your friends list, and you will no longer see when they are online. They can ask again.`
          : `${name} will be removed from your friends and will not be able to message you or ask to be your friend again, until you unblock them in Steam.`}
      </p>
      <div className="leave-confirm-actions">
        <button type="button" className="button subtle" autoFocus onClick={() => store.closeSteamDialog()}>
          Cancel
        </button>
        <button type="button" className="button danger" onClick={() => void store.doSteamFriend(dialog.what, dialog.bufferId)}>
          {removing ? 'Remove friend' : 'Block'}
        </button>
      </div>
    </Modal>
  )
}
