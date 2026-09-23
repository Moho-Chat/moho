import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useStore } from '../state/hooks'
import type { Account } from '../../../shared/wire'

interface ThirdPartyId {
  medium: string
  address: string
  addedAt?: number | null
}

/**
 * The addresses that can reach this account.
 *
 * An email or a phone number bound to a Matrix account is how a forgotten
 * password is recovered and how somebody who knows your email can find you.
 * Neither could be seen from here, which meant an account made in moho had no
 * way to recover, and one made elsewhere gave no sign of what it was already
 * carrying.
 *
 * Adding an email is the two steps it really is - the homeserver mails a
 * link, and the account changes only once somebody says they have followed
 * it. A single button would have to either lie about what happened or sit
 * there blocking on an inbox.
 */
export function MatrixAddresses({ account }: { account: Account }): JSX.Element {
  const store = useStore()
  const [ids, setIds] = useState<ThirdPartyId[] | null>(null)
  const [adding, setAdding] = useState('')
  /** The half-finished add: what the server called it, and our own secret. */
  const [pending, setPending] = useState<{ sid: string; clientSecret: string; address: string } | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = (): void => {
    void window.moho
      .rpc<{ threepids: ThirdPartyId[] }>('matrixThirdPartyIds', { accountId: account.id })
      .then((answer) => setIds(answer.threepids))
      // Quietly: an account still connecting has no answer yet, and an older
      // daemon has no such method.
      .catch(() => setIds([]))
  }

  useEffect(refresh, [account.id])

  const sendLink = (): void => {
    const address = adding.trim()
    if (!address) return
    setBusy(true)
    void window.moho
      .rpc<{ sid: string; clientSecret: string }>('matrixRequestEmailToken', {
        accountId: account.id,
        address
      })
      .then((answer) => {
        setPending({ ...answer, address })
        store.toast('info', `Sent a link to ${address}`)
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  const finish = (): void => {
    if (!pending) return
    setBusy(true)
    void window.moho
      .rpc('matrixAddThirdPartyId', {
        accountId: account.id,
        sid: pending.sid,
        clientSecret: pending.clientSecret,
        password
      })
      .then(() => {
        store.toast('info', `${pending.address} added`)
        setPending(null)
        setAdding('')
        setPassword('')
        refresh()
      })
      // The usual failure here is having pressed this before opening the
      // mail, which the server answers with an error saying so - shown as it
      // came, because the server's words are the accurate ones.
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  const remove = (id: ThirdPartyId): void => {
    void window.moho
      .rpc('matrixRemoveThirdPartyId', {
        accountId: account.id,
        medium: id.medium,
        address: id.address
      })
      .then(() => {
        store.toast('info', `${id.address} removed`)
        refresh()
      })
      .catch((e: Error) => store.toast('error', e.message))
  }

  return (
    <>
      <div className="setting-row">
        <div className="setting-text">
          <div>Addresses</div>
          <div className="small muted">
            How this account is reached and recovered. Anyone who knows one of these can find you
            on Matrix.
          </div>
        </div>
      </div>

      {ids?.length === 0 && (
        <p className="small muted">
          Nothing bound to this account. Without an email there is no way to recover a forgotten
          password.
        </p>
      )}

      {ids?.map((id) => (
        <div key={`${id.medium}:${id.address}`} className="device-row">
          <Icon name={id.medium === 'email' ? 'mail' : 'smartphone'} size={18} />
          <div className="setting-text">
            <div className="ellipsis">{id.address}</div>
            {id.addedAt ? (
              <div className="small muted">Added {new Date(id.addedAt * 1000).toLocaleDateString()}</div>
            ) : null}
          </div>
          <button type="button" className="button subtle" onClick={() => remove(id)}>
            Remove
          </button>
        </div>
      ))}

      {/* Email only. A phone number needs an identity server to send the
          message and to hold the binding, and this client has none - an
          existing one is still listed and can still be removed, which is the
          half that matters for taking an address off. */}
      {!pending ? (
        <div className="field-row">
          <input
            className="text-field"
            type="email"
            placeholder="Add an email address"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendLink()}
          />
          <button type="button" className="button subtle" disabled={!adding.trim() || busy} onClick={sendLink}>
            Send a link
          </button>
        </div>
      ) : (
        <div className="device-delete">
          <p className="small muted">
            Open the link sent to {pending.address}, then finish here. Your homeserver asks for
            your password before it will add the address.
          </p>
          <div className="field-row">
            <input
              className="text-field"
              type="password"
              placeholder="Account password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && password && finish()}
            />
            <button type="button" className="button" disabled={!password || busy} onClick={finish}>
              I have opened it
            </button>
            <button
              type="button"
              className="button subtle"
              onClick={() => {
                setPending(null)
                setPassword('')
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  )
}
