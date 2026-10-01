import { useEffect, useState } from 'react'
import { useStore } from '../state/hooks'
import type { Account } from '../../../shared/wire'

/**
 * Closing a Matrix account for good.
 *
 * An account registered in moho could only be closed from another client,
 * which is a small gap that is only ever noticed at the worst moment.
 *
 * The job here is to be honest rather than gentle. This cannot be undone, the
 * user id can never be signed in to or reused, the account's device keys go
 * with it, and everything it said in an encrypted room becomes unreadable to
 * anybody who did not already hold the keys. Two deliberate steps and the
 * password, which is what the homeserver asks for anyway.
 *
 * Except where the homeserver does not hold the account. A server that hands
 * its accounts to an OAuth provider - matrix.org, and every server running
 * Matrix Authentication Service - refuses this request outright, and the
 * account is closed on the provider's own page instead. So the daemon is
 * asked first which it is, and a password form is only drawn where a
 * password will do anything.
 */

/** How the daemon says this account can be closed. */
type Route = { route: 'password' } | { route: 'page'; url: string; direct: boolean } | { route: 'none' }
export function MatrixDeactivate({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  /** The spec's "redact my messages too", which a server may decline. */
  const [erase, setErase] = useState(false)
  const [busy, setBusy] = useState(false)
  const [route, setRoute] = useState<Route | null>(null)

  // Asked when the panel opens rather than for every account card drawn: it
  // is a request to the homeserver, and almost nobody opens this.
  useEffect(() => {
    if (!open || route) return
    void window.moho
      .rpc<Route>('matrixDeactivationRoute', { accountId: account.id })
      .then(setRoute)
      // Not knowing is not a reason to hide the way that works for most
      // servers; if it is the wrong one, the server says so.
      .catch(() => setRoute({ route: 'password' }))
  }, [open, route, account.id])

  const close = (): void => {
    setBusy(true)
    void window.moho
      .rpc('deactivateMatrixAccount', { accountId: account.id, password, erase })
      .then(() => {
        store.toast('info', 'That account is closed')
        void store.refreshAccounts()
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => {
        setBusy(false)
        setPassword('')
      })
  }

  if (!open) {
    return (
      <div className="button-row">
        <button type="button" className="button subtle danger" onClick={() => setOpen(true)}>
          Close this account…
        </button>
      </div>
    )
  }

  const cancel = (
    <button
      type="button"
      className="button subtle"
      onClick={() => {
        setOpen(false)
        setPassword('')
      }}
    >
      Cancel
    </button>
  )

  if (!route) {
    return (
      <div className="device-delete">
        <p className="small muted">Asking the homeserver how this account is closed…</p>
      </div>
    )
  }

  if (route.route !== 'password') {
    return (
      <div className="device-delete">
        <p className="small">
          <strong>{account.id.replace(/^matrix:/, '')}</strong> belongs to its homeserver&apos;s
          sign-in service, which does not let other apps close accounts. That happens on the
          service&apos;s own account page, if it allows it at all.
        </p>
        {route.route === 'page' ? (
          <>
            {!route.direct && (
              <p className="small muted">
                This service does not say that its page can close accounts, so it may not offer
                it.
              </p>
            )}
            <div className="field-row">
              <button type="button" className="button danger" onClick={() => void window.moho.openExternal(route.url)}>
                {route.direct ? 'Close it on the account page' : 'Open the account page'}
              </button>
              {cancel}
            </div>
          </>
        ) : (
          <>
            <p className="small muted">This service has no account page to send you to.</p>
            <div className="field-row">{cancel}</div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="device-delete">
      <p className="small">
        This closes <strong>{account.id.replace(/^matrix:/, '')}</strong> on its homeserver. It
        cannot be undone, the address can never be used again, and anything this account said in
        an encrypted room becomes unreadable to anyone who does not already have the keys.
      </p>
      {/* Its own choice, because it is a much larger one - and a server is
          allowed to ignore it, which is why this says "ask" rather than
          promising anything. */}
      <label className="small muted checkbox-row">
        <input type="checkbox" checked={erase} onChange={(e) => setErase(e.target.checked)} />
        Also ask the server to remove the messages this account sent
      </label>
      <div className="field-row">
        <input
          className="text-field"
          type="password"
          placeholder="Account password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="button" className="button danger" disabled={!password || busy} onClick={close}>
          Close it for good
        </button>
        {cancel}
      </div>
    </div>
  )
}
