import { useRef, useState } from 'react'
import { StatusPopout } from './StatusPopout'
import { Icon } from './Icon'
import { Avatar } from './Avatar'
import { useStore, useChat } from '../state/hooks'
import { presenceLabel } from '../lib/presence'
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
 * the plaque.
 */

export type Status = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline'

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

function label(status: Status | 'connecting', service: string): string {
  if (status === 'connecting') return 'Connecting…'
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
  const watching = account.service === 'kick' && !account.hasPassword && status !== 'connecting' && status !== 'offline'
  // Mute and deafen are the whole client's, for whatever call is up - so
  // shown on a service that has calls, or anywhere while one is running,
  // and not beside an IRC or Kick account with nothing to apply them to.
  const showVoice = account.service === 'discord' || account.service === 'matrix' || inACall

  return (
    <>
      <div className="user-footer">
        <button
          ref={identity}
          type="button"
          className="user-identity-button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          title={detail ? `${name} — ${label(status, account.service)}\n${detail}` : `${name} — ${label(status, account.service)}`}
        >
          <Avatar name={name} url={account.avatarUrl} size={28} status={status} accountId={account.id} />
          <span className="user-identity">
            <span className="ellipsis user-name">{name}</span>
            <span className="ellipsis small muted">{watching ? 'Watching, signed out' : label(status, account.service)}</span>
          </span>
        </button>

        {/* Always here, so the footer is the same shape on every account:
            where there is nothing to apply them to they are greyed, with the
            reason on hover, rather than gone. */}
        <button
          type="button"
          disabled={!showVoice}
          className={`user-audio-button${voice.micMuted ? ' muted' : ''}`}
          // Deafening silences the microphone too, so the button says so
          // rather than appearing to be a separate switch that stopped working.
          title={
            !showVoice
              ? `Voice isn't available on ${serviceLabel(account.service)}`
              : voice.deafened
                ? 'Muted while deafened'
                : voice.micMuted
                  ? 'Unmute microphone'
                  : 'Mute microphone'
          }
          aria-pressed={voice.micMuted}
          onClick={() => void store.setVoiceMuted({ micMuted: !voice.micMuted })}
        >
          <Icon name={voice.micMuted || voice.deafened ? 'mic_off' : 'mic'} size={18} />
        </button>

        <button
          type="button"
          disabled={!showVoice}
          className={`user-audio-button${voice.deafened ? ' muted' : ''}`}
          title={!showVoice ? `Voice isn't available on ${serviceLabel(account.service)}` : voice.deafened ? 'Undeafen' : 'Deafen'}
          aria-pressed={voice.deafened}
          onClick={() => void store.setVoiceMuted({ deafened: !voice.deafened })}
        >
          <Icon name={voice.deafened ? 'headset_off' : 'headset_mic'} size={18} />
        </button>
      </div>

      {open && (
        <StatusPopout account={account} status={status} anchor={identity.current} onClose={() => setOpen(false)} />
      )}
    </>
  )
}
