import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { useChat } from '../state/hooks'

/**
 * Who is in a Stoat voice channel, listed under it in the channel list as a Discord server's are: what anybody
 * decides on before joining. What the daemon last said, which it says as people come, go, mute and turn a camera on.
 */
export function StoatVoiceWho({ bufferId, accountId }: { bufferId: string; accountId: string }): JSX.Element | null {
  const members = useChat((s) => s.stoatVoice[bufferId]) ?? []
  if (members.length === 0) return null
  return (
    <>
      {members.map((m) => (
        <div key={m.userId} className="voice-member small">
          <span className="voice-member-face">
            <Avatar name={m.name} url={m.avatarUrl ?? undefined} size={20} accountId={accountId} />
          </span>
          <span className="ellipsis">{m.name}</span>
          {m.screen && (
            <span className="voice-state" title={`${m.name} is sharing a screen`}>
              <Icon name="screen_share" size={13} />
            </span>
          )}
          {m.camera && (
            <span className="voice-state" title={`${m.name} has a camera on`}>
              <Icon name="videocam" size={13} />
            </span>
          )}
          {m.muted && (
            <span className="voice-state" title={`${m.name} is muted`}>
              <Icon name="mic_off" size={13} />
            </span>
          )}
        </div>
      ))}
    </>
  )
}
