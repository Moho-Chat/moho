import { useEffect } from 'react'
import { Icon } from './Icon'
import { useChat, useStore } from '../state/hooks'
import type { Account } from '../../../shared/wire'

/**
 * Who an account has asked never to hear from, and the way back.
 *
 * Listed rather than only offered from a message, because the person somebody
 * wants to un-ignore is by definition one whose messages they can no longer
 * see. Without this, ignoring was a one-way door on every service but Matrix:
 * the gesture worked everywhere, and the list could only be read back on the
 * one protocol whose server keeps it.
 *
 * One component for every service rather than one per service. The daemon
 * already answers `listIgnored` for all of them - the homeserver's list where
 * there is one, its own where there is not - so the only thing that differs
 * here is the sentence explaining how far the ignore reaches.
 */
export function IgnoreList({ account }: { account: Account }): JSX.Element | null {
  const store = useStore()
  const ignored = useChat((s) => s.ignoredByAccount)[account.id] || []

  useEffect(() => {
    store.refreshIgnored(account.id)
  }, [account.id])

  // Nothing to show and nothing to explain. An empty list under a heading
  // reads as a feature that is not working rather than as an empty list.
  if (ignored.length === 0) return null

  return (
    <>
      <div className="setting-row">
        <div className="setting-text">
          <div>Ignored</div>
          <div className="small muted">{reach(account.service)}</div>
        </div>
      </div>
      {ignored.map((target) => (
        <div key={target} className="device-row">
          <Icon name="block" size={18} color="var(--warning)" />
          <div className="setting-text">
            <div className="ellipsis">{target}</div>
          </div>
          <button
            type="button"
            className="button subtle"
            onClick={() => store.setIgnored(account.id, target, false)}
          >
            Stop ignoring
          </button>
        </div>
      ))}
    </>
  )
}

/**
 * How far an ignore on this service actually reaches.
 *
 * Worth saying, because the two cases behave differently in a way somebody
 * will otherwise discover at the wrong moment: a Matrix or Discord ignore is
 * the account's own and follows them to their phone, while on the rest it is
 * this installation declining to show what the server still sends - so it does
 * not travel, and the other person is not blocked from anything.
 */
function reach(service: string): string {
  switch (service) {
    case 'matrix':
    case 'discord':
      return 'Kept on the account, so it holds on every client you sign in from.'
    default:
      return 'Kept by moho on this machine. The service is not told, so their messages still arrive - they are simply not shown.'
  }
}
