import { useRef, useState } from 'react'
import { StatusPopout } from './StatusPopout'
import { Icon } from './Icon'
import { AccountFace, accountPlace, accountState, askAccountsFor } from './AccountList'
import { useStore, useChat } from '../state/hooks'
import { presenceColor, presenceLabel } from '../lib/presence'
import { statusName } from '../lib/status'
import { serviceLabel } from '../lib/util'
import type { Account } from '../../../shared/wire'

/**
 * Who you are on the account you are currently looking at, at the foot of the
 * channel list - and the way to change how you are presenting.
 *
 * Per account rather than global because that is what the underlying status
 * is: each protocol carries its own. The microphone and speaker buttons
 * alongside it are the opposite: one machine has one microphone and one pair
 * of speakers, so they are deliberately not per account even though they share
 * the plaque - and they are only there where there is a call they could apply
 * to, so that everywhere else the name has the row (#339).
 */

export type Status = 'online' | 'idle' | 'focus' | 'dnd' | 'invisible' | 'offline'

/**
 * What the plaque should say, which is not always what the account last chose.
 *
 * A disconnected account is offline whatever status it holds - it is signed
 * out, and nobody can see it as anything. Reporting the stored status there
 * meant a Discord account that had dropped still showed a green dot and the
 * word Online.
 */
export function effectiveStatus(account: Account): Status | 'connecting' {
  if (account.state === 'connecting') return 'connecting'
  if (account.state !== 'connected') return 'offline'
  return (account.status as Status) || 'online'
}

function label(status: Status | 'connecting', service: string, auto = false): string {
  if (status === 'connecting') return 'Connecting…'
  if (status === 'idle' && auto) return 'Idle (away)'
  return status === 'invisible' ? statusName(service, 'invisible') : presenceLabel(status)
}

export function UserFooter({ account }: { account?: Account }): JSX.Element {
  const store = useStore()
  const [open, setOpen] = useState(false)
  const identity = useRef<HTMLButtonElement>(null)
  const voice = useChat((s) => s.voicePrefs)
  const inACall = useChat((s) => s.voiceSessions.length > 0 || !!s.activeCall)
  const details = useChat((s) => s.connectionDetail)

  // With no account selected there is nobody to show, but the footer still
  // has to exist so the layout doesn't jump when one arrives.
  if (!account) return <div className="user-footer empty" />

  const status = effectiveStatus(account)
  const name = account.displayName || account.id
  const detail = details[account.id]
  // A signed-out Kick account is a reader: it has no presence to show, and
  // "Online" claimed one.
  const watching = (account.service === 'kick' || account.service === 'twitch') && !account.hasPassword && status !== 'connecting' && status !== 'offline'
  // Mute and deafen are the whole client's, for whatever call is up - so
  // shown on a service that has calls, or anywhere while one is running,
  // and not beside an IRC or Kick account with nothing to apply them to.
  // Nor beside an account that is not connected: there is no call to be in.
  const showVoice = ((account.service === 'discord' || account.service === 'matrix' || account.service === 'steam') && account.state === 'connected') || inACall

  // How the connection is doing, as the Accounts page says it: it is what
  // the second line reads whenever the account is not simply connected.
  const state = accountState(account)
  // Where it is, for the services that are more than one place. The rest say it with the mark on the face.
  const place = accountPlace(account)
  const words = watching ? 'Watching, signed out' : state.tone === 'ok' ? label(status, account.service, account.autoIdle) : state.words
  const said = state.tone === 'ok' && !watching ? account.statusText?.trim() : ''
  const turnedAway = state.tone === 'bad'

  return (
    <>
      <div className={`user-footer tone-${state.tone}`}>
        <button
          ref={identity}
          type="button"
          className="user-identity-button"
          aria-haspopup={turnedAway ? undefined : 'menu'}
          aria-expanded={turnedAway ? undefined : open}
          onClick={() => {
            // Turned away: what there is to do about it is on the account's
            // own page, under the banner that says why.
            if (turnedAway) {
              askAccountsFor({ accountId: account.id })
              store.setActivePanel('accounts')
              return
            }
            setOpen(!open)
          }}
          title={[`${name} — ${words}`, place || serviceLabel(account.service), detail, turnedAway ? 'Click to open this account' : ''].filter(Boolean).join('\n')}
        >
          <AccountFace account={account} size={30} />
          <span className="user-identity">
            <span className="ellipsis user-name">{name}</span>
            <span className="user-state small">
              {state.tone === 'ok' ? (
                <span className="user-state-dot" style={{ background: watching ? 'var(--state-off)' : presenceColor(status) }} />
              ) : (
                <span className="state-pill-dot" />
              )}
              <span className="ellipsis">
                <span className="user-state-words">{said || words}</span>
                {place && <span className="muted"> · {place}</span>}
              </span>
            </span>
          </span>
          {turnedAway && <Icon name="chevron_right" size={16} className="user-identity-more" />}
        </button>

        {showVoice && (
          <>
            <button
              type="button"
              className={`user-audio-button${voice.micMuted ? ' muted' : ''}`}
              // Deafening silences the microphone too, so the button says so
              // rather than appearing to be a separate switch that stopped working.
              title={voice.deafened ? 'Muted while deafened' : voice.micMuted ? 'Unmute microphone' : 'Mute microphone'}
              aria-pressed={voice.micMuted}
              onClick={() => void store.setVoiceMuted({ micMuted: !voice.micMuted })}
            >
              <Icon name={voice.micMuted || voice.deafened ? 'mic_off' : 'mic'} size={18} />
            </button>

            <button
              type="button"
              className={`user-audio-button${voice.deafened ? ' muted' : ''}`}
              title={voice.deafened ? 'Undeafen' : 'Deafen'}
              aria-pressed={voice.deafened}
              onClick={() => void store.setVoiceMuted({ deafened: !voice.deafened })}
            >
              <Icon name={voice.deafened ? 'headset_off' : 'headset_mic'} size={18} />
            </button>
          </>
        )}
      </div>

      {open && (
        <StatusPopout account={account} status={account.autoIdle ? 'online' : status} anchor={identity.current} onClose={() => setOpen(false)} />
      )}
    </>
  )
}
