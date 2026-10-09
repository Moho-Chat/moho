import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'

/**
 * A sentence somebody has to write before something happens.
 *
 * Two things in moho need one and neither can be done well without it: a knock
 * on a room, where the reason is all the people inside have to decide by, and
 * a report to a server's moderators, where the reason is the whole report - a
 * moderator receiving "this message was reported" and nothing else knows only
 * that somebody pressed something.
 *
 * Deliberately not a confirm dialog with a text box bolted on. The text is the
 * point, so it has the focus from the first frame and Enter sends it; Escape
 * is how you leave without doing the thing.
 */
export function ReasonPrompt({
  title,
  detail,
  placeholder,
  confirmLabel,
  /** Whether an empty reason is allowed through. A knock may be wordless. */
  optional = false,
  danger = false,
  onConfirm,
  onCancel
}: {
  title: string
  detail: string
  placeholder: string
  confirmLabel: string
  optional?: boolean
  danger?: boolean
  onConfirm: (reason: string) => void
  onCancel: () => void
}): JSX.Element {
  const [reason, setReason] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    box.current?.focus()
  }, [])

  const ready = optional || reason.trim().length > 0

  return (
    <Modal title={title} icon={danger ? 'flag' : 'door_front'} onClose={onCancel} className="reason-prompt">
      <p className="small muted">{detail}</p>
      <textarea
        ref={box}
        className="reason-prompt-box"
        rows={3}
        value={reason}
        placeholder={placeholder}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, because this is one sentence rather than a
          // document; a newline is still there for anybody who wants two.
          if (e.key === 'Enter' && !e.shiftKey && ready) {
            e.preventDefault()
            onConfirm(reason.trim())
          }
        }}
      />
      <div className="reason-prompt-actions">
        <button type="button" className="button subtle" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={danger ? 'button danger' : 'button'}
          disabled={!ready}
          onClick={() => onConfirm(reason.trim())}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
