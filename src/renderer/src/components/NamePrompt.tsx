import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'

/**
 * A name asked for before something is made: a folder on a service that keeps
 * its own, which is made the moment it has one. Enter makes it, Escape leaves.
 *
 * A dialog and not a field in the list, because what is made is not a heading
 * of ours that can be renamed afterwards for free - it is a change to the
 * account on the service, and one that is called "New category" because the
 * field lost focus is a folder every other client of the account then shows.
 */
export function NamePrompt({
  title,
  detail,
  placeholder,
  confirmLabel,
  icon = 'create_new_folder',
  onConfirm,
  onCancel
}: {
  title: string
  detail: string
  placeholder: string
  confirmLabel: string
  icon?: string
  onConfirm: (name: string) => void
  onCancel: () => void
}): JSX.Element {
  const [name, setName] = useState('')
  const box = useRef<HTMLInputElement>(null)
  useEffect(() => {
    box.current?.focus()
  }, [])
  const ready = name.trim().length > 0
  return (
    <Modal title={title} icon={icon} onClose={onCancel} className="reason-prompt">
      <p className="small muted">{detail}</p>
      <input
        ref={box}
        className="reason-prompt-box"
        value={name}
        placeholder={placeholder}
        maxLength={64}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && ready) {
            e.preventDefault()
            onConfirm(name.trim())
          }
        }}
      />
      <div className="reason-prompt-actions">
        <button type="button" className="button subtle" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button" disabled={!ready} onClick={() => onConfirm(name.trim())}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
