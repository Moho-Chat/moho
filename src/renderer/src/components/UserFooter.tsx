import { ContextMenu, useContextMenu } from './ContextMenu'
import { Icon } from './Icon'
import { Avatar } from './Avatar'
import { useStore, useChat } from '../state/hooks'
import { presenceLabel } from '../lib/presence'
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

export type Status = 'online' | 'idle' | 'offline'

const STATUSES: { id: Status; label: string; glyph: string }[] = [
  { id: 'online', label: 'Online', glyph: 'circle' },
  { id: 'idle', label: 'Idle', glyph: 'dark_mode' },
  // Not a mood but an action: it signs the account out. Named for the state it
  // leaves you in rather than for the mechanism, since that is how it reads
  // beside the other two.
  { id: 'offline', label: 'Offline', glyph: 'logout' }
]

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

function label(status: Status | 'connecting'): string {
  return status === 'connecting' ? 'Connecting…' : presenceLabel(status)
}

export function UserFooter({ account }: { account?: Account }): JSX.Element {
  const store = useStore()
  const { menu, open, close } = useContextMenu()
  const voice = useChat((s) => s.voicePrefs)
  const details = useChat((s) => s.connectionDetail)

  // With no account selected there is nobody to show, but the footer still
  // has to exist so the layout doesn't jump when one arrives.
  if (!account) return <div className="user-footer empty" />

  const status = effectiveStatus(account)
  const name = account.displayName || account.id
  const detail = details[account.id]

  return (
    <>
      <div className="user-footer">
        <button
          type="button"
          className="user-identity-button"
          onClick={open}
          title={detail ? `${name} — ${label(status)}\n${detail}` : `${name} — ${label(status)}`}
        >
          <Avatar name={name} url={account.avatarUrl} size={28} status={status} />
          <span className="user-identity">
            <span className="ellipsis user-name">{name}</span>
            <span className="ellipsis small muted">{label(status)}</span>
          </span>
        </button>

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

        {/* Joining something new, beside the account it would be joined on.
            It used to sit in the heading above the channel list, where it read
            as belonging to whichever server was open rather than to the
            account - and where "+" next to a guild's name suggests adding
            something *to that guild*. Down here the account is named right
            beside it, which is the question the button actually answers. */}
        <button
          type="button"
          className="user-audio-button"
          title={`Join or add on ${serviceLabel(account.service)}`}
          onClick={() => store.setActivePanel('join', account.id)}
        >
          <Icon name="add" size={18} />
        </button>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={STATUSES.map((s) => ({
            label: s.id === status ? `${s.label} ✓` : s.label,
            icon: s.glyph,
            // Signing out is the one entry here that loses something - the
            // connection, and with it anything unsent - so it is marked as the
            // destructive one rather than sitting flush with the others.
            danger: s.id === 'offline' && status !== 'offline',
            onClick: () => void store.setPresence(account.id, s.id)
          }))}
          onClose={close}
        />
      )}
    </>
  )
}
