import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useStore } from '../state/hooks'
import type { Account } from '../../../shared/wire'

/**
 * What the account's card offers when the server will not let it in: the certificate it showed, to be looked at and
 * trusted or not, and a new password for one it refused.
 */
export function XmppAccountTools({ account }: { account: Account }): JSX.Element | null {
  const store = useStore()
  const [cert, setCert] = useState<{ sha256?: string; refused?: string } | null>(null)
  const [password, setPassword] = useState('')
  const stopped = account.state === 'auth_failed'

  useEffect(() => {
    if (!stopped) {
      setCert(null)
      return
    }
    void window.moho
      .rpc<{ sha256?: string; refused?: string }>('getXmppCertificate', { accountId: account.id })
      .then(setCert)
      .catch(() => setCert(null))
  }, [account.id, stopped])

  if (!stopped) return null

  const trust = (): void => {
    if (!cert?.sha256) return
    void window.moho
      .rpc('trustXmppCertificate', { accountId: account.id, sha256: cert.sha256 })
      .then(() => {
        setCert(null)
        void store.refreshAccounts()
      })
      .catch((e: Error) => store.toast('error', e.message))
  }
  const change = (): void => {
    void window.moho
      .rpc('setXmppPassword', { accountId: account.id, password })
      .then(() => {
        setPassword('')
        void store.refreshAccounts()
      })
      .catch((e: Error) => store.toast('error', e.message))
  }

  return (
    <div className="account-tools">
      {cert?.sha256 ? (
        <div className="warning-note">
          <Icon name="warning" size={16} />
          <div>
            <p>
              The server showed a certificate moho does not trust{cert.refused ? ` (${cert.refused})` : ''}. Compare this fingerprint with the one your
              server publishes before trusting it:
            </p>
            <p className="mono small">{cert.sha256.match(/.{2}/g)?.join(':')}</p>
            <button type="button" className="button" onClick={trust}>
              Trust this certificate
            </button>
          </div>
        </div>
      ) : (
        <div className="field-row">
          <label className="field">
            <span className="small muted">New password</span>
            <input
              className="text-field"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && password) change()
              }}
            />
          </label>
          <button type="button" className="button" disabled={!password} onClick={change}>
            Sign in again
          </button>
        </div>
      )}
    </div>
  )
}
