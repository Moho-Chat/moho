import { useEffect, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { DM_GROUP_ID } from '../lib/groups'

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
  const [level, setLevel] = useState(0)

  const session = sessions[0]

  useEffect(() => {
    if (!session) return
    // A meter rather than a static icon: the useful question during a call is
    // whether this machine is actually hearing anything, which no amount of
    // connection state answers.
    const tick = async (): Promise<void> => {
      try {
        const levels = await window.moho.rpc<{ accountId: string; micPeak: number }[]>('getVoiceLevels')
        setLevel(levels.find((l) => l.accountId === session.accountId)?.micPeak ?? 0)
      } catch {
        // A daemon that cannot answer is not worth a toast every second.
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), 1000)
    return () => clearInterval(timer)
  }, [session])

  if (!session) return null

  // A one-to-one call has no guild to go back to; its home is the
  // conversation itself, which the DM page holds.
  const groupId = session.guildId ? `${session.accountId}|guild:${session.guildId}` : DM_GROUP_ID
  const guildName = session.isDirect ? '' : (groups.find((g) => g.id === groupId)?.name ?? '')
  // Thresholds, not a linear scale of full scale. Measured on this hardware,
  // a quiet room sits around 0.008 and ordinary speech peaks between 0.02 and
  // 0.05 - so anything scaled against 1.0 stays dark while somebody is
  // talking, which is exactly the failure a meter exists to rule out.
  const bars = level > 0.05 ? 3 : level > 0.03 ? 2 : level > 0.015 ? 1 : 0

  return (
    <div className="voice-panel">
      <div className="voice-panel-head">
        <span className="voice-panel-state">
          <span className="voice-meter" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className={`voice-meter-bar${i < bars ? ' lit' : ''}`} />
            ))}
          </span>
          Voice Connected
        </span>
        <IconButton
          name="call_end"
          size={18}
          title="Disconnect"
          onClick={() => void store.leaveVoice(session.accountId)}
        />
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
