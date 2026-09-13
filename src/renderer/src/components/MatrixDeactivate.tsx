import { useState } from 'react'
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
 */
export function MatrixDeactivate({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  /** The spec's "redact my messages too", which a server may decline. */
  const [erase, setErase] = useState(false)
  const [busy, setBusy] = useState(false)

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
      </div>
    </div>
  )
}
