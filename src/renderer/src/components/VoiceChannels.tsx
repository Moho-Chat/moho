import { useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import { Icon, IconButton } from './Icon'
import { useChat, useIdSetPref, useStore } from '../state/hooks'
import { classes } from '../lib/util'
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
  const [, toggleFolded, isFolded] = useIdSetPref('collapsedCategories')
  const foldKey = `voice|${group.id}`
  const speaking = useSpeaking(group.accountId, sessions.some((s) => s.accountId === group.accountId))

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
      <button
        type="button"
        className="bufferlist-section category-head"
        onClick={() => toggleFolded(foldKey)}
        title={isFolded(foldKey) ? 'Show voice channels' : 'Hide voice channels'}
      >
        <Icon name="expand_more" size={14} className={classes('fold-chevron', isFolded(foldKey) && 'folded')} />
        <span>Voice</span>
      </button>

      {channels
        // Folded, the one you are in stays, as a folded category keeps its open channel.
        .filter((c) => !isFolded(foldKey) || session?.channelId === c.id)
        .map((c) => {
        const here = session?.channelId === c.id
        // On a stage the speakers come first and the audience after, which
        // is the order anybody deciding whether to listen reads it in.
        const members = c.stage
          ? [...(c.members ?? [])].sort((a, b) => Number(!!a.suppressed) - Number(!!b.suppressed))
          : (c.members ?? [])
        return (
          <div key={c.id} className={`voice-channel${here ? ' active' : ''}`}>
            {/* The row and the way out of it are siblings: a button inside a
                button is not valid, and the click that meant "disconnect"
                also reached the row's own handler. */}
            <div className="voice-channel-row">
              <button
                type="button"
                className="voice-channel-main"
                title={here ? `Connected to ${c.name}` : c.stage ? `Listen to ${c.name}` : `Join ${c.name}`}
                onClick={() => (here ? void store.leaveVoice(group.accountId) : void store.joinVoice(group.accountId, guild, c.id))}
              >
                <Icon name={c.stage ? 'podium' : 'volume_up'} size={16} />
                <span className="ellipsis">{c.name}</span>
                {/* A limit only means something once it is close to being hit. */}
                {c.userLimit > 0 && members.length >= c.userLimit - 1 && (
                  <span className="small muted voice-limit">
                    {members.length}/{c.userLimit}
                  </span>
                )}
              </button>
              {here && <IconButton name="call_end" size={16} title="Disconnect" onClick={() => void store.leaveVoice(group.accountId)} />}
            </div>
            {/* What a live stage is about. A stage with no topic is not on. */}
            {c.stage && c.topic && <div className="voice-stage-topic small muted ellipsis">{c.topic}</div>}

            {members.map((m) => (
              <div key={m.userId} className={classes('voice-member small', speaking.has(m.userId) && 'speaking')}>
                {/* Their face, ringed in green while they are heard - the thing
                    this list is for when you are in the call. The ring needs
                    the daemon's levels, which only exist for a call you are
                    in; from outside it, who is here is the whole answer. */}
                <span className="voice-member-face">
                  <Avatar name={m.nick} url={m.avatarUrl} size={20} accountId={group.accountId} />
                </span>
                <span className="ellipsis">{m.nick}</span>
                {m.isSelf && <span className="muted voice-you">you</span>}
                {c.stage && m.suppressed && !m.handRaised && <span className="muted voice-you">listening</span>}
                {c.stage && m.handRaised && (
                  <span className="muted" title={`${m.nick} has asked to speak`}>
                    <Icon name="front_hand" size={13} />
                  </span>
                )}
                {/* Here as well as in the call view, because this is the list
                    you read to decide whether to join at all - and somebody
                    sharing a screen is the commonest reason to. */}
                {/* Muted and deafened say so, the way Discord's own list does. */}
                {m.deafened ? (
                  <span className="voice-state" title={`${m.nick} has deafened themselves`}>
                    <Icon name="headset_off" size={13} />
                  </span>
                ) : (
                  m.muted && (
                    <span className="voice-state" title={`${m.nick} is muted`}>
                      <Icon name="mic_off" size={13} />
                    </span>
                  )
                )}
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

/**
 * Who is audible right now in the call this account is in, by user id.
 *
 * Asked of the daemon several times a second, but only while there is a call
 * to ask about and the window is showing: the levels exist only for a
 * connection this machine holds.
 */
function useSpeaking(accountId: string, inCall: boolean): Set<string> {
  const [speaking, setSpeaking] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!inCall) {
      setSpeaking((s) => (s.size ? new Set() : s))
      return
    }
    const tick = async (): Promise<void> => {
      // What the screenshot harness says is being heard (scripts/ui-shots.mjs);
      // only in a window it started.
      const staged = window.moho.uiShots
        ? (window as unknown as { __shotsSpeakers?: string[] }).__shotsSpeakers
        : undefined
      if (staged) {
        const now = new Set(staged)
        setSpeaking((was) => (was.size === now.size && [...now].every((id) => was.has(id)) ? was : now))
        return
      }
      try {
        const levels = await window.moho.rpc<
          { accountId: string; speakers?: { userId: string; peak: number }[] }[]
        >('getVoiceLevels')
        const mine = levels.find((l) => l.accountId === accountId)
        const now = new Set((mine?.speakers ?? []).filter((s) => s.peak > 0.01).map((s) => s.userId))
        setSpeaking((was) => (was.size === now.size && [...now].every((id) => was.has(id)) ? was : now))
      } catch {
        // No answer is no ring.
      }
    }
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void tick()
    }, 200)
    return () => clearInterval(timer)
  }, [accountId, inCall])
  return speaking
}
