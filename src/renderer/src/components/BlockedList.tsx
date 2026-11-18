import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useStore } from '../state/hooks'
import type { Account } from '../../../shared/wire'

/** Somebody the account itself has blocked. */
interface Blocked {
  id: string
  name: string
}

/**
 * Who an account has blocked on the service, and the way back.
 *
 * Different from ignoring, which the list above this is: an ignore is moho
 * declining to show somebody, and a block is the service turning them away for
 * the account, on every client. Steam and Stoat keep one; it used to be at the
 * foot of the "+" pane, which is for adding people rather than for who has
 * been shut out (#339).
 */
export function BlockedList({ account }: { account: Account }): JSX.Element | null {
  const store = useStore()
  const [blocked, setBlocked] = useState<Blocked[] | null>(null)
  const connected = account.state === 'connected'
  const steam = account.service === 'steam'

  useEffect(() => {
    let live = true
    setBlocked(null)
    if (steam) {
      void window.moho
        .rpc<{ steamid: string; name: string }[]>('steamBlockedList', { accountId: account.id })
        .then((b) => live && setBlocked(b.map((p) => ({ id: p.steamid, name: p.name }))))
        .catch(() => live && setBlocked([]))
    } else if (connected) {
      void window.moho
        .rpc<{ blocked?: { id: string; name: string | null }[] }>('stoatFriendRequests', { accountId: account.id })
        .then((r) => live && setBlocked((r.blocked ?? []).map((p) => ({ id: p.id, name: p.name || p.id }))))
        .catch(() => live && setBlocked([]))
    }
    // The daemon says the list again whenever it changes.
    const off = window.moho.onEvent((e) => {
      if (steam && e.event === 'steamBlocked') {
        const d = e.data as { accountId?: string; blocked?: { steamid: string; name: string }[] }
        if (d.accountId === account.id && d.blocked) setBlocked(d.blocked.map((p) => ({ id: p.steamid, name: p.name })))
      }
      if (!steam && e.event === 'stoatFriendRequests') {
        const d = e.data as { accountId?: string; blocked?: { id: string; name: string | null }[] }
        if (d.accountId === account.id) setBlocked((d.blocked ?? []).map((p) => ({ id: p.id, name: p.name || p.id })))
      }
    })
    return () => {
      live = false
      off()
    }
  }, [account.id, steam, connected])

  const unblock = (p: Blocked): void => {
    const call = steam
      ? window.moho.rpc('steamUnblock', { accountId: account.id, steamid: p.id })
      : window.moho.rpc('stoatBlock', { accountId: account.id, userId: p.id, block: false })
    void call.then(() => store.toast('info', `Unblocked ${p.name}`)).catch((e: Error) => store.toast('error', e.message))
  }

  return (
    <>
      <div className="setting-row">
        <div className="setting-text">
          <div>{blocked?.length ? 'Blocked' : 'Nobody is blocked on this account'}</div>
          <div className="small muted">
            Kept by {steam ? 'Steam' : 'the instance'} for the account, so it holds on every client: they cannot message you at all. Block somebody from their
            name or their profile.
          </div>
        </div>
      </div>
      {blocked?.map((p) => (
        <div key={p.id} className="device-row">
          <Icon name="block" size={18} color="var(--danger-text)" />
          <div className="setting-text">
            <div className="ellipsis" title={p.id}>
              {p.name}
            </div>
          </div>
          <button type="button" className="button subtle" disabled={!connected} onClick={() => unblock(p)}>
            Unblock
          </button>
        </div>
      ))}
    </>
  )
}
