import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useChat, useStore } from '../state/hooks'
import type { Account, MatrixDevice } from '../../../shared/wire'

/**
 * Per-account Matrix security tools: session verification (SAS "compare
 * emoji"), server-side key backup, and logging out other sessions.
 *
 * These live under the account rather than in Settings because each is tied to
 * one specific account's identity, unlike the room-display toggles.
 *
 * Verification here is always self-verification: the account is always our
 * own, and the device is another of our own logged-in sessions.
 */
export function MatrixAccountTools({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const verification = useChat((s) => s.matrixVerification)
  const [devices, setDevices] = useState<MatrixDevice[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState('')
  const [restoreKey, setRestoreKey] = useState('')
  const [busy, setBusy] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deletePassword, setDeletePassword] = useState('')

  const active = verification && verification.accountId === account.id ? verification : null

  const refresh = (): void => {
    setLoading(true)
    void window.moho
      .rpc<MatrixDevice[]>('listMatrixDevices', { accountId: account.id })
      .then(setDevices)
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [account.id])

  // A finished verification changes a device's verified flag server-side, so
  // the cached list here is stale the moment one completes.
  useEffect(() => {
    if (active?.state === 'done') refresh()
  }, [active?.state])

  const rpc = (method: string, params: Record<string, unknown>): Promise<any> =>
    window.moho.rpc(method, params).catch((e: Error) => {
      store.toast('error', e.message)
      throw e
    })

  return (
    <div className="matrix-tools">
      <div className="setting-row">
        <div className="setting-text">
          <div>Sessions</div>
          <div className="small muted">
            Your other logged-in devices. Verify one to let encrypted history decrypt across both.
          </div>
          {/* Said because the tick is otherwise a promise this cannot keep.
              moho does no cross-signing, so a verification here is recorded
              between these two sessions and never published - Element will
              still show the device as unverified, and somebody who was not
              told that would reasonably conclude one of the two clients is
              broken. */}
          <div className="small muted">
            Verifying marks a session as trusted <em>in moho</em>. moho does not do cross-signing,
            so other clients will still show it unverified.
          </div>
        </div>
        <button type="button" className="icon-button" title="Refresh" onClick={refresh}>
          <Icon name="refresh" size={16} />
        </button>
      </div>

      {loading && <p className="small muted">Loading sessions…</p>}
      {devices?.length === 0 && <p className="small muted">No other sessions signed in.</p>}

      {devices?.map((device) => (
        <div key={device.deviceId} className="device-row">
          <Icon
            name={device.verified ? 'verified_user' : 'gpp_maybe'}
            size={18}
            color={device.verified ? 'var(--success)' : 'var(--warning)'}
          />
          <div className="setting-text">
            <div className="ellipsis">{device.displayName || device.deviceId}</div>
            <div className="small muted">
              {device.deviceId} · {device.verified ? 'verified' : 'unverified'}
            </div>
          </div>
          {!device.verified && (
            <button
              type="button"
              className="button subtle"
              disabled={!!active}
              onClick={() =>
                void rpc('startMatrixVerification', { accountId: account.id, deviceId: device.deviceId })
              }
            >
              Verify
            </button>
          )}
          <button
            type="button"
            className="button danger"
            onClick={() => setDeleting(deleting === device.deviceId ? null : device.deviceId)}
          >
            Sign out
          </button>

          {deleting === device.deviceId && (
            <div className="device-delete">
              <p className="small muted">
                Signing out another session is password-gated by the Matrix spec.
              </p>
              <div className="field-row">
                <input
                  className="text-field"
                  type="password"
                  placeholder="Account password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                />
                <button
                  type="button"
                  className="button danger"
                  disabled={!deletePassword}
                  onClick={() =>
                    void rpc('deleteMatrixDevice', {
                      accountId: account.id,
                      deviceId: device.deviceId,
                      password: deletePassword
                    }).then(() => {
                      setDeleting(null)
                      setDeletePassword('')
                      refresh()
                    })
                  }
                >
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {active && (
        <div className="verification-box">
          {active.emoji ? (
            <>
              <div className="setting-text">Do these match on the other device?</div>
              <div className="sas-emoji">
                {active.emoji.map((e, i) => (
                  <div key={i} className="sas-cell">
                    <span className="sas-symbol">{e.symbol}</span>
                    <span className="small muted">{e.description}</span>
                  </div>
                ))}
              </div>
              <div className="button-row">
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    void rpc('confirmMatrixVerification', {
                      accountId: account.id,
                      verificationId: active.verificationId,
                      matches: true
                    })
                  }
                >
                  They match
                </button>
                <button
                  type="button"
                  className="button danger"
                  onClick={() =>
                    void rpc('confirmMatrixVerification', {
                      accountId: account.id,
                      verificationId: active.verificationId,
                      matches: false
                    })
                  }
                >
                  They don&apos;t
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="setting-text">
                Verification {active.state || 'starting'}…
              </div>
              <p className="small muted">
                Accept the request on your other session; the emoji to compare will appear here.
              </p>
              <div className="button-row">
                {active.state === 'requested' && (
                  <button
                    type="button"
                    className="button"
                    onClick={() =>
                      void rpc('respondMatrixVerification', {
                        accountId: account.id,
                        verificationId: active.verificationId,
                        accept: true
                      })
                    }
                  >
                    Accept
                  </button>
                )}
                <button
                  type="button"
                  className="button subtle"
                  onClick={() =>
                    void rpc('cancelMatrixVerification', {
                      accountId: account.id,
                      verificationId: active.verificationId
                    })
                  }
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="divider-h" />

      <div className="setting-row">
        <div className="setting-text">
          <div>Recovery key</div>
          <div className="small muted">
            Backs your room keys up to the homeserver, encrypted with a key only you hold. Without
            one, losing every signed-in session means losing access to encrypted history.
          </div>
        </div>
        <span className={`daemon-status${account.hasKeyBackup ? ' up' : ''}`}>
          <Icon name={account.hasKeyBackup ? 'check_circle' : 'gpp_maybe'} size={15} />
          {account.hasKeyBackup ? 'set up' : 'not set up'}
        </span>
      </div>

      {recoveryKey && (
        <div className="recovery-key">
          <p className="small">
            Save this somewhere safe — it is shown once and cannot be recovered.
          </p>
          <code className="selectable">{recoveryKey}</code>
        </div>
      )}

      <div className="button-row">
        <button
          type="button"
          className="button subtle"
          disabled={busy === 'setup'}
          onClick={() => {
            setBusy('setup')
            void rpc('setupMatrixRecoveryKey', { accountId: account.id })
              .then((r: { recoveryKey: string }) => {
                setRecoveryKey(r.recoveryKey)
                void store.refreshAccounts()
              })
              .finally(() => setBusy(''))
          }}
        >
          {account.hasKeyBackup ? 'Create a new recovery key' : 'Set up a recovery key'}
        </button>
      </div>

      <div className="field-row">
        <input
          className="text-field"
          placeholder="Restore from an existing recovery key"
          value={restoreKey}
          onChange={(e) => setRestoreKey(e.target.value)}
        />
        <button
          type="button"
          className="button subtle"
          disabled={!restoreKey || busy === 'restore'}
          onClick={() => {
            setBusy('restore')
            void rpc('restoreMatrixRecoveryKey', { accountId: account.id, recoveryKey: restoreKey })
              .then((r: { restoredKeys: number; totalKeys: number }) => {
                store.toast('info', `Restored ${r.restoredKeys} of ${r.totalKeys} room keys`)
                setRestoreKey('')
              })
              .finally(() => setBusy(''))
          }}
        >
          Restore
        </button>
      </div>
    </div>
  )
}
