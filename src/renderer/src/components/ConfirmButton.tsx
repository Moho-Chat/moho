import { useEffect, useState } from 'react'

/**
 * A button for something that interrupts - restarting Tor, restarting the
 * daemon - that asks once more before doing it, in place.
 *
 * Not a dialog: the question is about the thing in front of you and answers
 * itself in a click, and it takes itself back after a few seconds so a
 * forgotten question is not left lying about as a loaded button.
 */
export function ConfirmButton({
  label,
  question,
  confirmLabel,
  onConfirm,
  danger
}: {
  label: string
  /** What is being asked, in a few words: "Restart Tor and lose its circuits?" */
  question: string
  confirmLabel: string
  onConfirm: () => void
  danger?: boolean
}): JSX.Element {
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    if (!asking) return
    const t = setTimeout(() => setAsking(false), 6000)
    return () => clearTimeout(t)
  }, [asking])

  if (!asking) {
    return (
      <button type="button" className="button subtle" onClick={() => setAsking(true)}>
        {label}
      </button>
    )
  }
  return (
    <div className="confirm-button" role="alertdialog" aria-label={question}>
      <span className="small">{question}</span>
      <button
        type="button"
        className={danger ? 'button danger' : 'button'}
        onClick={() => {
          setAsking(false)
          onConfirm()
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="button subtle" autoFocus onClick={() => setAsking(false)}>
        Cancel
      </button>
    </div>
  )
}
