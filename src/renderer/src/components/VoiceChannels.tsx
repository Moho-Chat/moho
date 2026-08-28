import { useEffect } from 'react'
import { Icon, IconButton } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { nickColor } from '../lib/util'
import type { RailGroup } from '../lib/groups'

/**
 * A guild's voice channels, listed under its text ones.
 *
 * Who is in a channel is shown before you join rather than after, because that
 * is the whole basis on which anyone decides whether to.
 */
export function VoiceChannels({ group }: { group: RailGroup }): JSX.Element | null {
  const store = useStore()
  const channels = useChat((s) => s.voiceChannels)
  const guildId = useChat((s) => s.voiceGuildId)
  const sessions = useChat((s) => s.voiceSessions)

  // Only Discord guilds have these. The id carries the guild after the pipe -
  // see nobilis's guild_group_id.
  const guild = group.kind === 'guild' ? group.id.split('|guild:')[1] : ''

  useEffect(() => {
    if (!guild) return
    void store.refreshVoiceChannels(group.accountId, guild)
    void store.refreshVoiceSessions()
  }, [store, group.accountId, guild])

  // While a switch is in flight the previous guild's channels are still in the
  // store; showing them under the new guild's name would be a lie.
  if (!guild || guildId !== guild || channels.length === 0) return null

  const session = sessions.find((s) => s.accountId === group.accountId)

  return (
    <>
      <div className="bufferlist-section muted small">Voice</div>

      {channels.map((c) => {
        const here = session?.channelId === c.id
        const members = c.members ?? []
        return (
          <div key={c.id} className={`voice-channel${here ? ' active' : ''}`}>
            <button
              type="button"
              className="voice-channel-row"
              title={here ? `Connected to ${c.name}` : `Join ${c.name}`}
              onClick={() => (here ? void store.leaveVoice(group.accountId) : void store.joinVoice(group.accountId, guild, c.id))}
            >
              <Icon name="volume_up" size={16} />
              <span className="ellipsis">{c.name}</span>
              {/* A limit only means something once it is close to being hit. */}
              {c.userLimit > 0 && members.length >= c.userLimit - 1 && (
                <span className="small muted voice-limit">
                  {members.length}/{c.userLimit}
                </span>
              )}
              {here && <IconButton name="call_end" size={16} title="Disconnect" onClick={() => void store.leaveVoice(group.accountId)} />}
            </button>

            {members.map((m) => (
              <div key={m.userId} className="voice-member small">
                <span className="voice-member-dot" style={{ background: nickColor(m.nick) }} />
                <span className="ellipsis">{m.nick}</span>
                {m.isSelf && <span className="muted voice-you">you</span>}
                {/* Here as well as in the call view, because this is the list
                    you read to decide whether to join at all - and somebody
                    sharing a screen is the commonest reason to. */}
                {m.streaming && (
                  <span className="muted" title={`${m.nick} is sharing a screen`}>
                    <Icon name="screen_share" size={13} />
                  </span>
                )}
                {m.video && (
                  <span className="muted" title={`${m.nick} has a camera on`}>
                    <Icon name="videocam" size={13} />
                  </span>
                )}
              </div>
            ))}
          </div>
        )
      })}
    </>
  )
}
