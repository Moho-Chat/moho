import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { Avatar } from './Avatar'
import { useChat, usePref, useStore } from '../state/hooks'
import { isMutedBuffer } from '../lib/groups'
import { bufferDisplayName, formatFullTime, serviceLabel } from '../lib/util'
import type { Message } from '../../../shared/wire'

/**
 * Everything that mentioned you, from every service, newest first.
 *
 * The point of gathering these is that a mention worth answering is usually in
 * a channel nobody has open - so it is asked of the daemon rather than
 * assembled from what this window happens to have loaded, which is only ever
 * the conversations already being read.
 *
 * What counts as a mention is decided where the message arrives, by the
 * backend that can actually tell: Discord answers it from its own resolved
 * mentions array, and IRC from the nickname, because that is all IRC has.
 */
export function MentionsPage(): JSX.Element {
  const store = useStore()
  const buffers = useChat((s) => s.buffers)
  const accounts = useChat((s) => s.accounts)
  const [muted] = usePref<string[]>('mutedBuffers', [])
  const [mutedGroups] = usePref<string[]>('mutedGroups', [])
  const [rows, setMentions] = useState<Message[] | null>(null)

  // A muted conversation was told not to ask for attention. Collecting its
  // mentions into a page whose entire purpose is asking for attention would
  // be the one place that instruction is ignored.
  const mentions =
    rows?.filter((m) => {
      const buffer = buffers.find((b) => b.id === m.bufferId)
      return !buffer || !isMutedBuffer(buffer, muted, mutedGroups)
    }) ?? null

  useEffect(() => {
    let live = true
    void window.moho
      .rpc<Message[]>('getMentions', { limit: 100 })
      .then((rows) => live && setMentions(rows))
      .catch(() => live && setMentions([]))
    return () => {
      live = false
    }
  }, [])

  if (mentions === null) {
    return <div className="mentions-page muted">Looking…</div>
  }
  if (mentions.length === 0) {
    return (
      <div className="mentions-page empty muted">
        <Icon name="alternate_email" size={32} />
        <p>Nothing has mentioned you yet.</p>
      </div>
    )
  }

  return (
    <div className="mentions-page">
      {mentions.map((m) => {
        const buffer = buffers.find((b) => b.id === m.bufferId)
        const account = accounts.find((a) => a.id === buffer?.accountId)
        // A mention whose conversation this client has since forgotten still
        // shows: the message is the point, and refusing to draw it because the
        // buffer list has moved on would hide the very thing being collected.
        const where = buffer ? bufferDisplayName(buffer.name) : 'a closed conversation'
        return (
          <button
            key={m.id}
            type="button"
            className="mention-row"
            // Opens the conversation and scrolls to the message itself, which
            // is the only reason to click one of these.
            onClick={() => {
              if (!buffer) return
              void store.selectBuffer(buffer.id, true).then(() => store.jumpToMessage(buffer.id, m.id).then(() => store.setJumpTarget(m.id)))
            }}
            disabled={!buffer}
          >
            <Avatar name={m.from} url={m.avatarUrl} size={32} />
            <span className="mention-body">
              <span className="mention-head small">
                <span className="mention-from">{m.from}</span>
                <span className="muted">
                  in {where}
                  {account ? ` · ${serviceLabel(account.service)}` : ''}
                </span>
                <span className="muted mention-when">{formatFullTime(m.ts)}</span>
              </span>
              <span className="mention-text ellipsis">{m.body}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
