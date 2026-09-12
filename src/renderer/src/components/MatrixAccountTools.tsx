import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { resolveMediaUrl } from '../lib/util'
import type { Account, MatrixDevice } from '../../../shared/wire'

/** What the homeserver says this account is called and looks like. */
interface OwnProfile {
  accountId: string
  userId: string
  displayName: string
  avatarUrl?: string | null
  /**
   * What this homeserver lets the account change, from its own
   * `/capabilities`. Absent means permitted — a server that says nothing is
   * not a server saying no, and a field greyed out on silence would take away
   * something that very likely works.
   */
  canChangeName?: boolean
  canChangeAvatar?: boolean
}

/** Where an account stands on cross-signing, as the daemon reports it. */
interface CrossSigningStatus {
  accountId: string
  /** An identity exists on the homeserver, made by this client or another. */
  hasIdentity: boolean
  hasMaster: boolean
  /** This client holds the key that signs your own devices. */
  canSignDevices: boolean
  /** This client holds the key that signs other people. */
  canSignOthers: boolean
  /** This session has been signed by that identity. */
  thisDeviceSigned: boolean
  /** There is a stored password to answer the homeserver's challenge with. */
  canBootstrap: boolean
}

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
  const ignored = useChat((s) => s.matrixIgnored)[account.id] || []
  const [devices, setDevices] = useState<MatrixDevice[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState('')
  // Where this account's room calls go when the homeserver names no media
  // server of its own. Seeded from the account and only sent when it changes,
  // so opening this page does not rewrite a setting nobody touched.
  const [rtcFocus, setRtcFocus] = useState(account.rtcFocusUrl ?? '')
  const [restoreKey, setRestoreKey] = useState('')
  const [busy, setBusy] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [crossSigning, setCrossSigning] = useState<CrossSigningStatus | null>(null)
  const [profile, setProfile] = useState<OwnProfile | null>(null)
  const [profileName, setProfileName] = useState('')
  const [keyPassphrase, setKeyPassphrase] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [bootstrapPassword, setBootstrapPassword] = useState('')
  const [bootstrapping, setBootstrapping] = useState(false)

  const active = verification && verification.accountId === account.id ? verification : null

  const refresh = (): void => {
    setLoading(true)
    void window.moho
      .rpc<MatrixDevice[]>('listMatrixDevices', { accountId: account.id })
      .then(setDevices)
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setLoading(false))
    void window.moho
      .rpc<OwnProfile>('matrixOwnProfile', { accountId: account.id })
      .then((answer) => {
        setProfile(answer)
        setProfileName(answer.displayName || '')
      })
      .catch(() => setProfile(null))
    void window.moho
      .rpc<{ users: string[] }>('listMatrixIgnored', { accountId: account.id })
      .then((answer) => store.noteIgnored(account.id, answer.users))
      .catch(() => {})
    void window.moho
      .rpc<CrossSigningStatus>('matrixCrossSigningStatus', { accountId: account.id })
      .then(setCrossSigning)
      // Quietly: an account still connecting has no answer yet, and a toast
      // for that on every panel open would be noise.
      .catch(() => setCrossSigning(null))
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

  const rtcFocusChanged = rtcFocus.trim() !== (account.rtcFocusUrl ?? '')

  return (
    <div className="matrix-tools">
      <div className="setting-row">
        <div className="setting-text">
          <div>Sliding sync</div>
          <div className="small muted">
            A newer, much lighter way of talking to the homeserver: it sends the rooms that
            changed instead of the whole account every time. Worth it on an account in a lot of
            rooms. Still new here — if this account stops receiving messages, turn it back off.
          </div>
        </div>
        <button
          type="button"
          className={account.slidingSync ? 'button' : 'button subtle'}
          onClick={() =>
            void rpc('setMatrixSlidingSync', { accountId: account.id, enabled: !account.slidingSync })
              .then(() =>
                store.toast(
                  'info',
                  account.slidingSync
                    ? 'Sliding sync off — reconnect this account to go back to the old sync'
                    : 'Sliding sync on — reconnect this account to start using it'
                )
              )
              .then(() => void store.refreshAccounts())
          }
        >
          {account.slidingSync ? 'On' : 'Off'}
        </button>
      </div>
      <div className="setting-row">
        <div className="setting-text">
          <div>Call server</div>
          <div className="small muted">
            Where this account&rsquo;s room calls go. Most homeservers name one and this can stay
            empty; a server that does not leaves calls with nowhere to go until one is given
            here.
          </div>
        </div>
      </div>
      <div className="device-row">
        <Icon name="cell_tower" size={18} />
        <div className="field-row setting-text">
          <input
            className="text-field"
            placeholder="https://livekit.example.org"
            value={rtcFocus}
            onChange={(e) => setRtcFocus(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="button subtle"
          disabled={!rtcFocusChanged}
          onClick={() =>
            void rpc('setMatrixRtcFocus', { accountId: account.id, url: rtcFocus.trim() })
              .then(() =>
                store.toast(
                  'info',
                  rtcFocus.trim() ? 'Call server set' : 'Call server cleared - the homeserver decides again'
                )
              )
              .then(() => void store.refreshAccounts())
          }
        >
          {rtcFocus.trim() ? 'Save' : 'Clear'}
        </button>
      </div>
      <div className="setting-row">
        <div className="setting-text">
          <div>Sessions</div>
          <div className="small muted">
            Your other logged-in devices. Verify one to let encrypted history decrypt across both.
          </div>
          {/* What a verification here is actually worth, which depends on
              whether this account has a cross-signing identity: with one, the
              agreement is published and every client sees it; without one, it
              is a private note between these two sessions. Saying which is
              the difference between a tick that means something and a tick
              somebody reasonably reads as a broken client. */}
          <div className="small muted">
            {crossSigning?.thisDeviceSigned
              ? 'Verifying publishes the result, so other clients see it too.'
              : crossSigning?.hasIdentity
                ? 'This session is not signed by your identity yet. Verify it against another session to publish it.'
                : 'Without cross-signing, verifying is a private note between two sessions.'}
          </div>
        </div>
        <button type="button" className="icon-button" title="Refresh" onClick={refresh}>
          <Icon name="refresh" size={16} />
        </button>
      </div>

      {/* Who everybody else sees. Separate from the display name in the
          account card above it, and the difference is worth stating: that
          one is what moho calls this account, this one is what every room
          you are in shows. */}
      <div className="setting-row">
        <div className="setting-text">
          <div>Your profile on {account.id.split(':').slice(1).join(':')}</div>
          <div className="small muted">Changing these changes them for everyone.</div>
        </div>
      </div>
      <div className="device-row">
        {profile?.avatarUrl ? (
          <img className="account-avatar" src={resolveMediaUrl(profile.avatarUrl)} alt="" />
        ) : (
          <Icon name="account_circle" size={18} />
        )}
        <div className="field-row setting-text">
          <input
            className="text-field"
            type="text"
            placeholder={profile?.userId || 'Display name'}
            value={profileName}
            disabled={profile?.canChangeName === false}
            title={profile?.canChangeName === false ? 'This homeserver does not allow changing your display name' : undefined}
            onChange={(e) => setProfileName(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="button subtle"
          disabled={
            profile?.canChangeName === false ||
            !profileName.trim() ||
            profileName.trim() === profile?.displayName
          }
          onClick={() =>
            void rpc('setMatrixProfileName', { accountId: account.id, name: profileName.trim() })
              .then(() => store.toast('info', 'Name changed'))
              .then(refresh)
          }
        >
          Save name
        </button>
        <button
          type="button"
          className="button subtle"
          disabled={profile?.canChangeAvatar === false}
          title={profile?.canChangeAvatar === false ? 'This homeserver does not allow changing your picture' : undefined}
          onClick={() =>
            void window.moho.pickFile().then((path) => {
              if (!path) return
              return rpc('setMatrixProfileAvatar', { accountId: account.id, path })
                .then(() => store.toast('info', 'Picture changed'))
                .then(refresh)
            })
          }
        >
          Change picture
        </button>
      </div>

      {/* Setting it up, where there is nothing to set up against. Never
          offered as a reset: replacing an existing identity un-verifies
          every device you have, everywhere, for everyone. */}
      {crossSigning && !crossSigning.hasIdentity && (
        <div className="device-row">
          <Icon name="key" size={18} color="var(--warning)" />
          <div className="setting-text">
            <div>Cross-signing is not set up</div>
            <div className="small muted">
              An identity of your own, so a session verified here is verified everywhere. Your
              homeserver asks for your password before it will publish the keys.
            </div>
          </div>
          {crossSigning.canBootstrap ? (
            <button
              type="button"
              className="button subtle"
              disabled={bootstrapping}
              onClick={() => {
                setBootstrapping(true)
                void rpc('matrixBootstrapCrossSigning', { accountId: account.id })
                  .then(() => store.toast('info', 'Cross-signing is set up'))
                  .then(refresh)
                  .finally(() => setBootstrapping(false))
              }}
            >
              {bootstrapping ? 'Setting up…' : 'Set up'}
            </button>
          ) : (
            <div className="field-row">
              <input
                className="text-field"
                type="password"
                placeholder="Account password"
                value={bootstrapPassword}
                onChange={(e) => setBootstrapPassword(e.target.value)}
              />
              <button
                type="button"
                className="button subtle"
                disabled={bootstrapping || !bootstrapPassword}
                onClick={() => {
                  setBootstrapping(true)
                  void rpc('matrixBootstrapCrossSigning', {
                    accountId: account.id,
                    password: bootstrapPassword
                  })
                    .then(() => {
                      setBootstrapPassword('')
                      store.toast('info', 'Cross-signing is set up')
                    })
                    .then(refresh)
                    .finally(() => setBootstrapping(false))
                }}
              >
                Set up
              </button>
            </div>
          )}
        </div>
      )}

      {/* Set up, but this client cannot sign with it - the private keys live
          on whichever session created them, and arrive here over a
          verification rather than out of thin air. */}
      {crossSigning?.hasIdentity && !crossSigning.canSignOthers && (
        <p className="small muted">
          Verify this session against one that has your cross-signing keys to be able to verify
          other people from here.
        </p>
      )}

      {/* A copy of the room keys that does not depend on the homeserver.
          Beside the server-side backup rather than instead of it: one
          survives losing every device, the other survives losing the
          server. */}
      <div className="setting-row">
        <div className="setting-text">
          <div>Key file</div>
          <div className="small muted">
            The encrypted export Element writes, for moving history to a client that cannot reach
            the backup - or for keeping a copy of your own.
          </div>
        </div>
      </div>
      <div className="device-row">
        <Icon name="vpn_key" size={18} />
        <div className="field-row setting-text">
          <input
            className="text-field"
            type="password"
            placeholder="Passphrase for the file"
            value={keyPassphrase}
            onChange={(e) => setKeyPassphrase(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="button subtle"
          disabled={!keyPassphrase || keyBusy}
          onClick={() =>
            void window.moho.pickSavePath('element-keys.txt').then((path) => {
              if (!path) return
              setKeyBusy(true)
              return rpc('exportMatrixKeys', {
                accountId: account.id,
                path,
                passphrase: keyPassphrase
              })
                .then((answer: { keys: number }) =>
                  store.toast('info', `Wrote ${answer.keys} room keys`)
                )
                .finally(() => setKeyBusy(false))
            })
          }
        >
          Export
        </button>
        <button
          type="button"
          className="button subtle"
          disabled={!keyPassphrase || keyBusy}
          onClick={() =>
            void window.moho.pickFile().then((path) => {
              if (!path) return
              setKeyBusy(true)
              return rpc('importMatrixKeys', {
                accountId: account.id,
                path,
                passphrase: keyPassphrase
              })
                .then((answer: { imported: number; total: number }) =>
                  // Both numbers, because they differ and only the first
                  // answers "did that do anything".
                  store.toast('info', `Imported ${answer.imported} of ${answer.total} keys`)
                )
                .finally(() => setKeyBusy(false))
            })
          }
        >
          Import
        </button>
      </div>

      {/* Who this account has asked never to hear from, and the way back.
          Listed here rather than only offered from a message, because the
          person you want to un-ignore is by definition somebody whose
          messages you can no longer see. */}
      {ignored.length > 0 && (
        <div className="setting-row">
          <div className="setting-text">
            <div>Ignored</div>
            <div className="small muted">
              Kept on the account, so it holds on every client you sign in from.
            </div>
          </div>
        </div>
      )}
      {ignored.map((userId) => (
        <div key={userId} className="device-row">
          <Icon name="block" size={18} color="var(--warning)" />
          <div className="setting-text">
            <div className="ellipsis">{userId}</div>
          </div>
          <button
            type="button"
            className="button subtle"
            onClick={() => store.setIgnored(account.id, userId, false)}
          >
            Stop ignoring
          </button>
        </div>
      ))}

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

      {/* The emoji comparison is drawn over the whole window now rather
          than in here: a verification can arrive from another session, or
          from another person through a room you share, and this panel is
          not necessarily open when one does. */}
      {active && (
        <p className="small muted">
          A verification is in progress — the comparison is shown over the window.
        </p>
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
