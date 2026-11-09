import { useEffect, useState } from 'react'
import { useStore } from '../state/hooks'
import type { Account } from '../../../shared/wire'

/** One of the account's devices, as the phone's list of linked devices shows it. */
interface Device {
  id: number
  name: string
  createdAt: number
  lastSeen: number
  isThis: boolean
}

function when(seconds: number): string {
  return seconds > 0 ? new Date(seconds * 1000).toLocaleDateString() : 'never'
}

/**
 * The devices linked to a Signal account, under its card in the Accounts pane, and the name this one has among them.
 * Signal lets only the phone remove another device, so the others are listed and not offered for removal; this one is
 * removed by removing the account here.
 */
export function SignalAccountTools({ account }: { account: Account }): JSX.Element | null {
  const store = useStore()
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = (): void => {
    void window.moho
      .rpc<Device[]>('signalDevices', { accountId: account.id })
      .then((list) => {
        setDevices(list)
        setName(list.find((d) => d.isThis)?.name ?? '')
      })
      // An account still connecting has no answer yet; nothing is shown in its place.
      .catch(() => setDevices(null))
  }
  // Asked again once the account is up, since the first open can be before it is.
  useEffect(load, [account.id, account.state])

  if (!devices) return null
  const mine = devices.find((d) => d.isThis)
  const rename = (): void => {
    setBusy(true)
    void window.moho
      .rpc('renameSignalDevice', { accountId: account.id, name })
      .then(() => {
        store.toast('info', 'Device renamed')
        load()
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="account-tools">
      <div className="setting-row">
        <div className="setting-text">
          <div>Linked devices</div>
          <div className="small muted">Remove one from Signal on your phone: Settings, then Linked devices.</div>
        </div>
      </div>
      <ul className="plain-list">
        {devices.map((d) => (
          <li key={d.id} className="small">
            {d.name || (d.id === 1 ? 'Phone' : `Device ${d.id}`)}
            {d.isThis ? ' (this one)' : ''} <span className="muted">· last seen {when(d.lastSeen)}</span>
          </li>
        ))}
      </ul>
      {mine && (
        <div className="field-row">
          <label className="field">
            <span className="small muted">Name of this device in that list</span>
            <input className="text-field" type="text" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="button" className="button" disabled={busy || !name.trim() || name.trim() === mine.name} onClick={rename}>
            Rename
          </button>
        </div>
      )}
    </div>
  )
}
