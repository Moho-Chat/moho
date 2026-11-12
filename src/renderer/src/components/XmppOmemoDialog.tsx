import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { useStore } from '../state/hooks'

interface Device {
  jid: string
  device: number
  own: boolean
  fingerprint: string
  known: boolean
  trust: 'undecided' | 'trusted' | 'verified' | 'untrusted'
  /** The device speaks OMEMO 2 (urn:xmpp:omemo:2); the others are written to in the older namespace. */
  omemo2?: boolean
}

/**
 * OMEMO for one conversation: whether it is encrypted, this device's fingerprint, and each device the other person has (and this
 * account's other devices) with the fingerprint it showed and whether it is trusted. A fingerprint means something only if
 * the person has been asked, by some other way, whether theirs is the same: so there are three answers, not two - trusted
 * (written to, unchecked), verified (checked), and not trusted (not written to).
 */
export function XmppOmemoDialog({ bufferId, accountId, jid, name, encrypted, onClose }: { bufferId: string; accountId: string; jid: string; name: string; encrypted: boolean; onClose: () => void }): JSX.Element {
  const store = useStore()
  const [info, setInfo] = useState<{ deviceId: number; fingerprint: string; devices: Device[] } | null>(null)
  const [error, setError] = useState('')
  const load = (): void => {
    void window.moho
      .rpc<{ deviceId: number; fingerprint: string; devices: Device[] }>('xmppOmemoDevices', { accountId, jid })
      .then(setInfo)
      .catch((e: Error) => setError(e.message))
  }
  useEffect(load, [accountId, jid])
  const trust = (d: Device, level: string): void => {
    void window.moho
      .rpc('xmppOmemoTrust', { accountId, jid: d.jid, device: d.device, trust: level })
      .then(load)
      .catch((e: Error) => store.toast('error', e.message))
  }
  const reset = (): void => {
    void window.moho
      .rpc<{ devices: number }>('xmppOmemoReset', { accountId, jid })
      .then((r) => {
        store.toast('info', `New sessions with ${r.devices} device${r.devices === 1 ? '' : 's'} of ${jid}`)
        load()
      })
      .catch((e: Error) => store.toast('error', e.message))
  }
  const toggle = (): void => {
    void window.moho
      .rpc('xmppSetEncryption', { bufferId, on: !encrypted })
      .then(() => store.toast('info', encrypted ? 'Encryption is off for this conversation' : 'This conversation is encrypted'))
      .catch((e: Error) => store.toast('error', e.message))
  }
  return (
    <Modal title={`Encryption — ${name}`} icon="lock" onClose={onClose} className="xmpp-omemo-dialog">
      <div className="add-form">
        <label className="check-row">
          <input type="checkbox" checked={encrypted} onChange={toggle} />
          <span>Encrypt what I send in this conversation (OMEMO)</span>
        </label>
        <p className="small muted">
          Messages are encrypted to each trusted device of {jid} and to your other devices.
        </p>
        {error && <p className="warning-note">{error}</p>}
        {info && (
          <>
            <p className="small muted">This device ({info.deviceId}) — compare this with what the other person sees:</p>
            <p className="mono small">{info.fingerprint}</p>
            <ul className="plain-list">
              {info.devices
                .filter((d) => !d.own)
                .map((d) => (
                  <li key={`${d.jid}/${d.device}`} className="add-form">
                    <span>
                      {d.jid} · device {d.device} · {d.omemo2 ? 'OMEMO 2' : 'OMEMO (older)'} · <strong>{d.trust}</strong>
                    </span>
                    <span className="mono small">{d.known ? d.fingerprint : 'Not seen yet: its keys are fetched when a message is sent'}</span>
                    <div className="field-row">
                      <button type="button" className="button small" disabled={d.trust === 'verified'} onClick={() => trust(d, 'verified')}>
                        I have compared it
                      </button>
                      <button type="button" className="button small" disabled={d.trust === 'trusted'} onClick={() => trust(d, 'trusted')}>
                        Trust
                      </button>
                      <button type="button" className="button small" disabled={d.trust === 'untrusted'} onClick={() => trust(d, 'untrusted')}>
                        Do not trust
                      </button>
                    </div>
                  </li>
                ))}
              {info.devices.filter((d) => !d.own).length === 0 && <li className="small muted">No other devices are known.</li>}
            </ul>
            <p className="small muted">
              If messages from {jid} cannot be read, or yours cannot be read by them, the sessions may be broken: start new ones (their devices are
              sent new keys; nothing is said).
            </p>
            <div className="field-row">
              <button type="button" className="button small" onClick={reset}>
                Start new sessions
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
