import { Avatar } from './Avatar'
import { dmStatus } from './BufferList'
import { useChat } from '../state/hooks'
import type { BufferEntry } from '../state/store'

/**
 * The face at the head of a conversation: their picture, and how they are.
 *
 * Shown only where there is one person to show. A channel's header has no
 * single face, and inventing one - the first member, the last to speak -
 * would be worse than none.
 */
export function BufferFace({ buffer }: { buffer: BufferEntry }): JSX.Element | null {
  const presence = useChat((s) => s.presenceByBuffer)
  const buffers = useChat((s) => s.buffers)
  if (buffer.kind !== 'dm') return null

  return (
    <span className="header-face">
      <Avatar name={buffer.name} url={buffer.avatarUrl} size={24} status={dmStatus(buffer, presence, buffers)} />
    </span>
  )
}
