import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { Avatar } from './Avatar'
import { useChat, useStore } from '../state/hooks'
import { bufferDisplayName } from '../lib/util'

/**
 * Where to send somebody else's message on to.
 *
 * A list of the conversations this window has, filtered as you type, because
 * on an account with three hundred channels a picker without a search box is
 * a picker nobody can use.
 *
 * Ordered by what was said in recently, since a message being forwarded is
 * usually going somewhere the person has just been.
 */
export function ForwardPicker({
  bufferId,
  messageId,
  onClose
}: {
  bufferId: string
  messageId: string
  onClose: () => void
}): JSX.Element {
  const store = useStore()
  const buffers = useChat((s) => s.buffers)
  const accounts = useChat((s) => s.accounts)
  const [query, setQuery] = useState('')
  const [sending, setSending] = useState('')
  const box = useRef<HTMLInputElement>(null)

  useEffect(() => {
    box.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const source = buffers.find((b) => b.id === bufferId)
  const choices = useMemo(() => {
    const q = query.trim().toLowerCase()
    return buffers
      .filter((b) => b.id !== bufferId && b.kind !== 'server')
      .filter((b) => !q || bufferDisplayName(b.name).toLowerCase().includes(q))
      .sort((a, b) => (b.lastActivityTs ?? 0) - (a.lastActivityTs ?? 0))
      .slice(0, 60)
  }, [buffers, bufferId, query])

  const send = (toBufferId: string): void => {
    setSending(toBufferId)
    void window.moho
      .rpc('forwardMessage', { fromBufferId: bufferId, messageId, toBufferId })
      .then(() => {
        store.toast('info', 'Sent it on')
        onClose()
      })
      .catch((e: Error) => {
        setSending('')
        store.toast('error', e.message)
      })
  }

  return createPortal(
    <div className="lightbox-backdrop" onClick={onClose}>
      <div className="forward-picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="discord-modal-head">
          <Icon name="forward" size={18} />
          <span>Send this on</span>
        </div>
        <input
          ref={box}
          className="text-field"
          placeholder="Which conversation…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="forward-picker-list">
          {choices.map((buffer) => {
            const account = accounts.find((a) => a.id === buffer.accountId)
            // Discord carries a forward itself; everywhere else it is a
            // quoted copy, and it is worth saying which before it is sent.
            const native =
              source?.accountId === buffer.accountId && buffer.accountId.startsWith('discord:')
            return (
              <button
                key={buffer.id}
                type="button"
                className="forward-choice"
                disabled={!!sending}
                onClick={() => send(buffer.id)}
              >
                <Avatar name={buffer.name} url={buffer.avatarUrl} size={22} />
                <span className="ellipsis">{bufferDisplayName(buffer.name)}</span>
                <span className="small muted ellipsis">
                  {account?.displayName ?? ''}
                  {native ? '' : ' · as a quote'}
                </span>
                {sending === buffer.id && <span className="spinner" aria-label="Sending" />}
              </button>
            )
          })}
          {choices.length === 0 && (
            <p className="small muted emoji-empty">No conversation here by that name.</p>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
