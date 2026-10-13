import { Icon } from './Icon'
import { useChat, useStore } from '../state/hooks'

/**
 * A warning the service has put on a conversation, over the top of it, in red,
 * until the person dismisses it.
 *
 * Steam's "this person may not be who they appear to be" is the one there is.
 * Said in the log as well, where it stays in its place; this is what stops it
 * being missed by somebody who opens the conversation scrolled to the bottom.
 * Dismissing tells the service, which does not raise it again - and if it does
 * raise one, the banner is back, because that is a new warning.
 */
export function ConversationNotice({ bufferId }: { bufferId: string }): JSX.Element | null {
  const notice = useChat((s) => s.buffers.find((b) => b.id === bufferId)?.notice)
  const store = useStore()
  if (!notice) return null
  return (
    <div className="notice-banner" role="alert">
      <Icon name="warning" size={18} />
      <span className="notice-banner-text">{notice.text}</span>
      <button type="button" className="notice-banner-dismiss" onClick={() => void store.dismissNotice(bufferId)}>
        Dismiss
      </button>
    </div>
  )
}
