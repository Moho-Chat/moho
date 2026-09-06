import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

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
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const ready = optional || reason.trim().length > 0

  return createPortal(
    <div className="lightbox-backdrop" onClick={onCancel}>
      <div className="reason-prompt" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="reason-prompt-head">
          <Icon name={danger ? 'flag' : 'door_front'} size={18} />
          <span>{title}</span>
        </div>
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
          <button type="button" className="button" onClick={onCancel}>
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
      </div>
    </div>,
    document.body
  )
}
