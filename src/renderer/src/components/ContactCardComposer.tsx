import { useState } from 'react'
import { Modal } from './Modal'
import { useStore } from '../state/hooks'

/**
 * Sharing a contact card in a Signal conversation: a name and the ways to reach them, as Signal's apps send one from the
 * address book. moho has no address book of its own, so the card is written here.
 */
export function ContactCardComposer({ bufferId, onClose }: { bufferId: string; onClose: () => void }): JSX.Element {
  const store = useStore()
  const [name, setName] = useState('')
  const [number, setNumber] = useState('')
  const [email, setEmail] = useState('')
  const [organization, setOrganization] = useState('')
  const [sending, setSending] = useState(false)
  const ready = name.trim().length > 0 && (number.trim().length > 0 || email.trim().length > 0)

  const send = (): void => {
    setSending(true)
    void window.moho
      .rpc('signalSendContact', {
        bufferId,
        name: name.trim(),
        numbers: number.split(',').map((n) => n.trim()).filter(Boolean),
        emails: email.split(',').map((e) => e.trim()).filter(Boolean),
        organization: organization.trim()
      })
      .then(onClose)
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setSending(false))
  }

  const field = (label: string, value: string, set: (v: string) => void, placeholder: string, autoFocus = false): JSX.Element => (
    <label className="field">
      <span className="small muted">{label}</span>
      <input className="text-field" value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => set(e.target.value)} />
    </label>
  )

  return (
    <Modal title="Share a contact" icon="contact_page" className="modal poll-composer" onClose={onClose}>
      {field('Name', name, setName, 'Their name', true)}
      {field('Phone numbers', number, setNumber, '+44 7700 900123 (separate several with commas)')}
      {field('Email addresses', email, setEmail, 'name@example.org')}
      {field('Organisation (optional)', organization, setOrganization, '')}
      <div className="small muted">A name and a number or email address. It is sent as a card the other side can save.</div>
      <div className="field-row">
        <button type="button" className="button" disabled={!ready || sending} onClick={send}>
          {sending ? 'Sharing…' : 'Share'}
        </button>
      </div>
    </Modal>
  )
}
