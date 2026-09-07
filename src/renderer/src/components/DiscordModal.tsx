import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { useChat, useStore } from '../state/hooks'

/**
 * A form a bot asked for.
 *
 * Discord's third answer to a slash command, after a message and a row of
 * buttons: a modal, which is a handful of text boxes and a send. Until this
 * existed those commands appeared to do nothing at all - the form arrived,
 * was dropped, and the person was left looking at a channel where they had
 * pressed something and nothing had happened.
 *
 * Drawn from what the bot sent rather than from a template: the labels, the
 * placeholders, which boxes are one line and which are several, and which may
 * be left empty are all its own, and a client that decided any of them for
 * itself would be filling in a form on somebody else's behalf.
 */
export function DiscordModal(): JSX.Element | null {
  const store = useStore()
  const modal = useChat((s) => s.discordModal)
  const [values, setValues] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const first = useRef<HTMLTextAreaElement | HTMLInputElement>(null)

  // A new form starts empty, except where the bot filled something in.
  useEffect(() => {
    if (!modal) return
    const start: Record<string, string> = {}
    for (const field of modal.fields) start[field.customId] = field.value ?? ''
    setValues(start)
    setSending(false)
    first.current?.focus()
  }, [modal])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') store.closeDiscordModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  if (!modal) return null

  // What the bot said it needs. Checked here so the button says so before it
  // is pressed, rather than the send coming back refused.
  const missing = modal.fields.filter(
    (field) => field.required !== false && !(values[field.customId] ?? '').trim()
  )
  const tooLong = modal.fields.filter(
    (field) => field.maxLength && (values[field.customId] ?? '').length > field.maxLength
  )
  const ready = missing.length === 0 && tooLong.length === 0

  const send = (): void => {
    if (!ready || sending) return
    setSending(true)
    void store.submitDiscordModal(values)
  }

  return createPortal(
    <div className="lightbox-backdrop" onClick={() => store.closeDiscordModal()}>
      <div className="discord-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="discord-modal-head">
          <Icon name="edit_note" size={18} />
          <span>{modal.title}</span>
        </div>

        {modal.fields.map((field, i) => {
          const value = values[field.customId] ?? ''
          const set = (next: string): void =>
            setValues((all) => ({ ...all, [field.customId]: next }))
          return (
            <label key={field.customId} className="discord-modal-field">
              <span className="small muted">
                {field.label || field.customId}
                {field.required === false && ' · optional'}
                {field.maxLength ? ` · ${value.length}/${field.maxLength}` : ''}
              </span>
              {field.long ? (
                <textarea
                  ref={i === 0 ? (first as React.RefObject<HTMLTextAreaElement>) : undefined}
                  className="reason-prompt-box"
                  rows={4}
                  value={value}
                  placeholder={field.placeholder}
                  onChange={(e) => set(e.target.value)}
                />
              ) : (
                <input
                  ref={i === 0 ? (first as React.RefObject<HTMLInputElement>) : undefined}
                  className="text-field"
                  value={value}
                  placeholder={field.placeholder}
                  onChange={(e) => set(e.target.value)}
                  onKeyDown={(e) => {
                    // One line means Enter finishes it, which is what a
                    // single box in a form is for.
                    if (e.key === 'Enter') send()
                  }}
                />
              )}
            </label>
          )
        })}

        <div className="reason-prompt-actions">
          <button type="button" className="button" onClick={() => store.closeDiscordModal()}>
            Cancel
          </button>
          <button type="button" className="button" disabled={!ready || sending} onClick={send}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
