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

interface Info {
  deviceId: number
  fingerprint: string
  devices: Device[]
  /** This device's verification link in the form most clients scan, and XEP-0434's trust-message link, each with a QR code. */
  uri?: string
  qr?: string
  trustUri?: string
  trustQr?: string
}

/**
 * OMEMO for one conversation: whether it is encrypted, this device's fingerprint, and each device the other person has (and this
 * account's other devices) with the fingerprint it showed and whether it is trusted. A fingerprint means something only if
 * the person has been asked, by some other way, whether theirs is the same: so there are three answers, not two - trusted
 * (written to, unchecked), verified (checked), and not trusted (not written to).
 */
export function XmppOmemoDialog({ bufferId, accountId, jid, name, encrypted, onClose }: { bufferId: string; accountId: string; jid: string; name: string; encrypted: boolean; onClose: () => void }): JSX.Element {
  const store = useStore()
  const [info, setInfo] = useState<Info | null>(null)
  const [link, setLink] = useState('')
  const [showTrustLink, setShowTrustLink] = useState(false)
  const [error, setError] = useState('')
  const load = (): void => {
    void window.moho
      .rpc<Info>('xmppOmemoDevices', { accountId, jid })
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
  const verifyLink = (): void => {
    void window.moho
      .rpc<{ jid: string; verified: number; distrusted: number; waiting: number }>('xmppOmemoVerifyUri', { accountId, uri: link.trim() })
      .then((r) => {
        const parts = [r.verified && `${r.verified} device${r.verified === 1 ? '' : 's'} verified`, r.distrusted && `${r.distrusted} distrusted`, r.waiting && `${r.waiting} key${r.waiting === 1 ? '' : 's'} not seen yet (decided when ${r.jid} uses them)`].filter(Boolean)
        store.toast('info', `${r.jid}: ${parts.join(', ') || 'nothing changed'}`)
        setLink('')
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
            {(showTrustLink ? info.trustQr : info.qr) && (
              <div className="omemo-qr">
                <img alt="This device's verification code" src={`data:image/svg+xml;utf8,${encodeURIComponent((showTrustLink ? info.trustQr : info.qr) ?? '')}`} width={180} height={180} />
                <p className="small muted">
                  Scan this from the other person&apos;s device to verify this one.{' '}
                  <button type="button" className="link-button" onClick={() => setShowTrustLink(!showTrustLink)}>
                    {showTrustLink ? 'Show the code most clients scan' : 'Show the XEP-0434 code (Kaidan)'}
                  </button>
                </p>
                <p className="mono small">{showTrustLink ? info.trustUri : info.uri}</p>
              </div>
            )}
            <div className="field-row">
              <input
                type="text"
                placeholder="Paste a verification link (xmpp:…?omemo-sid-… or …?trust-message;…)"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && link.trim() && verifyLink()}
              />
              <button type="button" className="button small" disabled={!link.trim()} onClick={verifyLink}>
                Verify
              </button>
            </div>
            <p className="small muted">Verifying a device tells your other verified devices, and it, so they need not be compared again (Automatic Trust Management).</p>
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
