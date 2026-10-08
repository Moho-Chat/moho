import { useEffect, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { DM_GROUP_ID } from '../lib/groups'
import { levelFill } from '../lib/voiceLevel'

/**
 * The call you are in, shown above the account plaque.
 *
 * A voice connection outlives whatever is on screen - the daemon holds it, so
 * it survives changing channel, changing server, and this window being closed
 * and reopened. That is the point of the panel: without it the only sign of an
 * open microphone is the one channel row that shows it, which disappears the
 * moment you go and read something else.
 *
 * It sits outside the selected group for the same reason, and clicking it goes
 * back to where the call is.
 */
export function VoicePanel(): JSX.Element | null {
  const store = useStore()
  const sessions = useChat((s) => s.voiceSessions)
  const groups = useChat((s) => s.groups)
  const sharing = useChat((s) => s.discordSharing)
  const [level, setLevel] = useState(0)
  const [rtt, setRtt] = useState<number | null>(null)

  const session = sessions[0]

  useEffect(() => {
    if (!session) return
    // A meter rather than a static icon: the useful question during a call is
    // whether this machine is actually hearing anything, which no amount of
    // connection state answers.
    const tick = async (): Promise<void> => {
      // The screenshot harness has no call to listen to, and says what the
      // panel should show (scripts/ui-shots.mjs). Only in a window it started.
      const staged = window.moho.uiShots
        ? (window as unknown as { __shotsLevels?: { micPeak: number; rttMs: number | null } }).__shotsLevels
        : undefined
      if (staged) {
        setLevel(staged.micPeak)
        setRtt(staged.rttMs)
        return
      }
      try {
        const levels = await window.moho.rpc<{ accountId: string; micPeak: number; rttMs?: number | null }[]>(
          'getVoiceLevels'
        )
        const mine = levels.find((l) => l.accountId === session.accountId)
        setLevel(mine?.micPeak ?? 0)
        setRtt(mine?.rttMs ?? null)
      } catch {
        // A daemon that cannot answer is not worth a toast every second.
      }
    }
    void tick()
    // Often enough that the bar follows speech rather than lagging it; not
    // while the window is hidden, where nobody is looking at it.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void tick()
    }, 150)
    return () => clearInterval(timer)
  }, [session])

  if (!session) return null

  // A one-to-one call has no guild to go back to; its home is the
  // conversation itself, which the DM page holds.
  const groupId = session.guildId ? `${session.accountId}|guild:${session.guildId}` : DM_GROUP_ID
  const guildName = session.isDirect ? '' : (groups.find((g) => g.id === groupId)?.name ?? '')
  const fill = levelFill(level)
  const quality = rtt === null ? null : rtt < 80 ? 'good' : rtt < 160 ? 'fair' : 'poor'

  return (
    <div className="voice-panel">
      <div className="voice-panel-head">
        <span className="voice-panel-state">
          Voice Connected
          {/* How the connection to the voice server is, in the one unit that
              means anything: how long it takes to answer. Absent until the
              first answer has come back, and where the service has no such
              number. */}
          {rtt !== null && quality && (
            <span className={`voice-ping ${quality}`} title={`Round trip to the voice server: ${rtt} ms`}>
              {rtt} ms
            </span>
          )}
        </span>
        {/* Sharing a screen into the call you are in, from where the call is
            shown rather than only from inside it. Discord's calls only: those
            are the ones that live in the daemon and have no stage of their
            own to hold the control. */}
        {session.accountId.startsWith('discord:') && (
          <IconButton
            name={sharing === session.accountId ? 'stop_screen_share' : 'screen_share'}
            size={18}
            title={sharing === session.accountId ? 'Stop sharing your screen' : 'Share your screen'}
            className={sharing === session.accountId ? 'active' : undefined}
            onClick={() => void store.toggleScreenShare()}
          />
        )}
        <IconButton
          name="call_end"
          size={18}
          title="Disconnect"
          onClick={() => void store.leaveVoice(session.accountId)}
        />
      </div>

      {/* What the microphone is hearing, which is how somebody knows it is
          the one they think it is before they say something into silence. */}
      <div
        className={`voice-level${fill > 0.85 ? ' hot' : ''}`}
        role="meter"
        aria-label="Microphone level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fill * 100)}
        title="What your microphone is hearing"
      >
        <span className="voice-level-fill" style={{ width: `${Math.round(fill * 100)}%` }} />
      </div>

      <button
        type="button"
        className="voice-panel-where ellipsis"
        title={session.isDirect ? 'Go to this conversation' : guildName ? `Go to ${guildName}` : 'Go to this server'}
        onClick={() => store.selectGroup(groupId)}
      >
        <Icon name="volume_up" size={14} />
        <span className="ellipsis">
          {session.channelName}
          {guildName && <span className="muted"> / {guildName}</span>}
        </span>
      </button>
    </div>
  )
}
