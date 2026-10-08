import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageRow, useRowContext } from './MessageRow'
import { isGrouped } from './MessageList'
import { IconButton } from './Icon'
import { useChat, usePref, useStore } from '../state/hooks'
import type { ChatMessage } from '../state/store'

/**
 * A thread, beside the room it belongs to.
 *
 * A side panel rather than its own buffer, because a thread is not a place
 * you go - it is an aside inside a conversation you are already reading, and
 * putting it in the buffer list would fill that list with fragments that
 * appear and go quiet. Element makes the same call, and somebody moving
 * between the two clients should not have to learn two shapes.
 *
 * What it shows is merged from two places: what the server said the thread
 * contains, and anything that has arrived in the room since. The second is
 * what makes a live thread move without re-asking.
 */
export function ThreadPanel(): JSX.Element | null {
  const thread = useChat((s) => s.openThread)
  const messagesByBuffer = useChat((s) => s.messagesByBuffer)
  // The same two settings the room itself reads (display.*): this panel used
  // to ask for `ui.*`, which nothing writes, so it ignored both.
  const [comfy] = usePref<'classic' | 'comfy' | 'bubbles'>('display.messageMode', 'comfy')
  const [relativeTimestamps] = usePref<boolean>('display.relativeTimestamps', false)
  const store = useStore()
  // Before the early return below, as every hook here has to be.
  const shared = useRowContext(thread?.bufferId ?? '')
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // From the account, as the room does, not by splitting its id.
  const service = thread ? store.accountFor(thread.bufferId)?.service : undefined
  const body = useRef<HTMLDivElement>(null)

  const messages = useMemo((): ChatMessage[] => {
    if (!thread) return []
    const live = (messagesByBuffer[thread.bufferId] || []).filter(
      (m) => m.id === thread.rootId || (m.replyTo?.thread && m.replyTo.id === thread.rootId)
    )
    // By id, so a message that is both fetched and live appears once. The
    // live copy wins: it is the one carrying edits and reactions that have
    // happened since the fetch.
    const byId = new Map<string, ChatMessage>()
    for (const m of [...thread.messages, ...live]) byId.set(m.id, m)
    return [...byId.values()].sort((a, b) => a.ts - b.ts)
  }, [thread, messagesByBuffer])

  // Opened on, and following, the newest reply: a thread is read from its end.
  const count = messages.length
  useEffect(() => {
    const el = body.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thread?.rootId, count])

  if (!thread) return null

  const send = (): void => {
    const body = draft.trim()
    if (!body) return
    setDraft('')
    void store.sendToThread(body)
  }

  return (
    <div className="thread-pane">
      <div className="thread-header">
        <span className="thread-title ellipsis">Thread</span>
        <span className="small muted">
          {Math.max(0, messages.length - 1) === 1 ? '1 reply' : `${Math.max(0, messages.length - 1)} replies`}
        </span>
        <IconButton name="close" title="Close thread" onClick={() => store.closeThreadPanel()} />
      </div>

      <div className="thread-body" ref={body}>
        {messages.map((msg, i) => (
          <MessageRow
            key={msg.id}
            message={msg}
            bufferId={thread.bufferId}
            service={service}
            // One author's run reads as one, as it does in the room - but the
            // thread's first message stands on its own.
            grouped={comfy !== 'classic' && i > 1 && isGrouped(messages, i)}
            mode={comfy === 'bubbles' ? 'comfy' : comfy}
            lastInRun={i === messages.length - 1}
            relativeTimestamps={relativeTimestamps}
            mediaAutoplay={false}
            mediaLoop={false}
            contentSniffing={false}
            inThread
            shared={shared}
          />
        ))}
        {thread.loading && messages.length === 0 && (
          <div className="muted small thread-empty">Reading the thread…</div>
        )}
        {!thread.loading && messages.length === 0 && (
          <div className="muted small thread-empty">
            This thread is not in local history and the server did not return it.
          </div>
        )}
      </div>

      {/* Its own box, not the room's. Typing here answers the thread, and the
          room's composer still answers the room - which is the whole reason
          somebody opens one of these. */}
      <div className="thread-composer">
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          placeholder="Reply in thread"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <IconButton name="send" title="Send" onClick={send} />
      </div>
    </div>
  )
}
