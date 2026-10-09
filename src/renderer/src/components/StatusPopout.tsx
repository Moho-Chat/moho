import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { useStore, usePref } from '../state/hooks'
import { useEscapeLayer } from '../lib/layers'
import { presenceClass } from '../lib/presence'
import { classes } from '../lib/util'
import type { Account } from '../../../shared/wire'
import { statusName, supportsStatus } from '../lib/status'
import type { Status } from './UserFooter'

/** The statuses that can be chosen, with the dot each is drawn with. Signing out is separate, below them. */
const CHOICES: { id: Exclude<Status, 'offline'>; label: string; hint?: string; dot: string }[] = [
  { id: 'online', label: 'Online', dot: 'online' },
  { id: 'idle', label: 'Idle', dot: 'idle' },
  { id: 'dnd', label: 'Do not disturb', dot: 'dnd' },
  // Connected and reading, and counted as away by everybody looking.
  { id: 'invisible', label: 'Invisible', hint: 'You will appear offline', dot: 'offline' }
]

/** Longest custom status the services will take; Discord's is 128. */
const MAX_TEXT = 128

/**
 * How you are presenting, over the footer it belongs to.
 *
 * A popout rather than a context menu because it holds more than a list of
 * choices: the status with the one in use ticked and drawn in its own colour,
 * what to say beside it where the service has a place for that, and whether
 * the choice is for this account or for all of them.
 */
export function StatusPopout({
  account,
  status,
  anchor,
  onClose
}: {
  account: Account
  status: Status | 'connecting'
  anchor: HTMLElement | null
  onClose: () => void
}): JSX.Element {
  const store = useStore()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)
  const [applyAll, setApplyAll] = usePref<boolean>('status.applyToAll', false)
  const canSay = account.service === 'discord' || account.service === 'matrix'
  const [text, setText] = useState(account.statusText ?? '')

  useEscapeLayer(onClose)

  // Above the footer it opened from, with its left edge on it.
  useLayoutEffect(() => {
    if (!anchor) return
    const r = anchor.getBoundingClientRect()
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 280 - 8)), bottom: window.innerHeight - r.top + 6 })
  }, [anchor])

  useEffect(() => {
    // Pressing inside it must not close it; anywhere else does.
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (ref.current?.contains(target) || anchor?.contains(target)) return
      onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [anchor, onClose])

  const choose = (next: Exclude<Status, 'offline'>): void => {
    // The words ride with a choice of status where there are any to say, so a
    // change of colour does not quietly take them down.
    const said = canSay ? text.trim() : undefined
    if (applyAll) void store.setStatusEverywhere(next, said)
    else void store.setPresence(account.id, next, said)
    onClose()
  }

  const saveText = (): void => {
    const current = status === 'connecting' || status === 'offline' ? 'online' : status
    void store.setAccountStatus(account.id, current as Exclude<Status, 'offline'>, text.trim())
    onClose()
  }

  return createPortal(
    <div
      ref={ref}
      className="status-popout"
      role="menu"
      aria-label="Set your status"
      style={pos ? { left: pos.left, bottom: pos.bottom } : { visibility: 'hidden' }}
    >
      {CHOICES.filter((c) => supportsStatus(account.service, c.id)).map((c) => (
        <button
          key={c.id}
          type="button"
          role="menuitemradio"
          aria-checked={c.id === status}
          className={classes('status-choice', c.id === status && 'current')}
          onClick={() => choose(c.id)}
        >
          <span className={classes('status-dot', presenceClass(c.dot))} />
          <span className="status-choice-text">
            <span>{statusName(account.service, c.id)}</span>
            {c.hint && <span className="small muted">{account.service === 'matrix' ? 'Your presence is set to offline' : c.hint}</span>}
          </span>
          {c.id === status && <Icon name="check" size={16} className="status-check" />}
        </button>
      ))}

      {canSay && (
        <>
          <div className="status-rule" />
          <label className="status-say">
            <span className="small muted">Custom status</span>
            <span className="status-say-row">
              <input
                className="text-field"
                value={text}
                maxLength={MAX_TEXT}
                placeholder="What's up?"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    saveText()
                  }
                }}
              />
              {text && (
                <button
                  type="button"
                  className="icon-button"
                  title="Clear"
                  onClick={() => {
                    setText('')
                    void store.setAccountStatus(account.id, (status === 'connecting' || status === 'offline' ? 'online' : status) as Exclude<Status, 'offline'>, '')
                  }}
                >
                  <Icon name="close" size={14} />
                </button>
              )}
            </span>
          </label>
        </>
      )}

      <div className="status-rule" />
      <div className="switch-row status-all">
        <span className="switch-text">
          <span>Apply to all accounts</span>
          <span className="small muted">Your choice goes to every account that is signed in</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={applyAll}
          className={classes('switch', applyAll && 'on')}
          onClick={() => setApplyAll(!applyAll)}
        >
          <span className="switch-knob" />
        </button>
      </div>

      <div className="status-rule" />
      <button
        type="button"
        role="menuitem"
        className={classes('status-choice', 'danger')}
        disabled={status === 'offline'}
        onClick={() => {
          void store.setPresence(account.id, 'offline')
          onClose()
        }}
      >
        <Icon name="logout" size={16} />
        <span className="status-choice-text">
          <span>Sign out</span>
        </span>
      </button>
    </div>,
    document.body
  )
}
