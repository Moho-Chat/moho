import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { Stage, type StageButton, type StageTile } from './stage/Stage'
import { FeedPicture } from './stage/FeedPicture'
import { cameraKey, streamKey } from '../lib/framefeed'
import type { VoiceMember, VoiceSession } from '../../../shared/wire'

/** How often to ask who is talking. */
const POLL_MS = 300

/**
 * Where a microphone stops being a quiet room and starts being speech.
 *
 * The same threshold the level meter in the voice panel uses, measured on
 * real hardware: a silent room still reads around 0.008, so anything lower
 * would leave your own tile permanently ringed.
 */
const SPEAKING_FLOOR = 0.015

interface Levels {
  accountId: string
  micPeak: number
  speakers?: { userId: string; peak: number }[]
}

/**
 * The Discord call this conversation should be showing.
 *
 * Two ways to match, because the two kinds of call are anchored differently.
 * A one-to-one call belongs to the DM it is in. A guild's voice channel
 * belongs to no text conversation - it is its own channel, with no buffer -
 * so it shows on whatever channel of that guild is open, which is where
 * Discord keeps it too.
 */
function useSessionFor(bufferId: string): VoiceSession | undefined {
  const sessions = useChat((s) => s.voiceSessions)
  const buffers = useChat((s) => s.buffers)
  const buffer = buffers.find((b) => b.id === bufferId)
  return sessions.find(
    (s) =>
      s.bufferId === bufferId ||
      (!!s.guildId && !!buffer?.groupId && buffer.groupId === `${s.accountId}|guild:${s.guildId}`)
  )
}

/**
 * The Discord call, above the conversation it belongs to - or, once popped
 * out, a line saying where it went.
 */
export function CallView({ bufferId }: { bufferId: string }): JSX.Element | null {
  const store = useStore()
  const session = useSessionFor(bufferId)
  const poppedOut = useChat((s) => s.callPoppedOut)
  const matrixCall = useChat((s) => s.activeCall)
  if (!session) return null
  // Only one call can be in the window of its own, and a Matrix call takes it
  // if there is one - see CallWindowHost.
  if (poppedOut && !matrixCall) {
    return (
      <div className="stage-away">
        <Icon name="open_in_new" size={16} />
        <span className="small">The call is in its own window.</span>
        <button type="button" className="button subtle" onClick={() => store.setCallPoppedOut(false)}>
          Bring it back
        </button>
      </div>
    )
  }
  return <DiscordStage session={session} where="inline" />
}

/** A Discord call drawn on the stage, wherever the stage is. */
export function DiscordStage({ session, where }: { session: VoiceSession; where: 'inline' | 'window' }): JSX.Element {
  const store = useStore()
  const buffers = useChat((s) => s.buffers)
  const cameras = useChat((s) => s.discordCameras)
  const sharing = useChat((s) => s.discordSharing)
  const watching = useChat((s) => s.discordWatching)
  const voicePrefs = useChat((s) => s.voicePrefs)
  const [members, setMembers] = useState<VoiceMember[]>([])
  const [speaking, setSpeaking] = useState<Record<string, number>>({})
  const { accountId, channelId } = session

  // Who is in it. Re-asked rather than pushed, because arriving and leaving a
  // call are voice-state dispatches this client does not otherwise subscribe
  // to, and a roster that only filled in once would show whoever happened to
  // be there when the call was joined.
  useEffect(() => {
    let live = true
    const load = (): void => {
      void window.moho
        .rpc<VoiceMember[]>('listVoiceMembers', { accountId, channelId })
        .then((rows) => live && setMembers(rows))
        .catch(() => undefined)
    }
    load()
    const timer = setInterval(load, 3000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [accountId, channelId])

  // Who is talking. Faster than the roster because a ring that lagged a second
  // behind the voice would read as the wrong person speaking.
  useEffect(() => {
    let live = true
    const tick = (): void => {
      void window.moho
        .rpc<Levels[]>('getVoiceLevels')
        .then((rows) => {
          if (!live) return
          const mine = rows.find((r) => r.accountId === accountId)
          const next: Record<string, number> = {}
          for (const s of mine?.speakers ?? []) next[s.userId] = s.peak
          // Your own microphone never comes back through the call, so the one
          // person the speaker list cannot name is you: filled in from the mic.
          if (mine && mine.micPeak > SPEAKING_FLOOR) next.self = mine.micPeak
          setSpeaking(next)
        })
        .catch(() => undefined)
    }
    tick()
    const timer = setInterval(tick, POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [accountId])

  const tiles: StageTile[] = []
  for (const m of members) {
    const camera = cameras[`${accountId}|${m.userId}`]
    tiles.push({
      id: m.userId,
      name: m.isSelf ? `${m.nick} (you)` : m.nick,
      avatarUrl: m.avatarUrl,
      speaking: m.isSelf ? speaking.self !== undefined : (speaking[m.userId] ?? 0) > 0,
      muted: m.muted,
      deafened: m.deafened,
      picture: camera ? () => <FeedPicture feedKey={cameraKey(accountId, m.userId)} /> : undefined
    })
    // A shared screen is a tile of its own, the way Discord shows it: dark
    // until somebody chooses to watch, because watching opens a connection.
    if (m.streaming) {
      const watched = watching?.accountId === accountId && watching.userId === m.userId
      tiles.push({
        id: `stream:${m.userId}`,
        name: m.isSelf ? 'Your screen' : `${m.nick}’s screen`,
        avatarUrl: m.avatarUrl,
        live: true,
        picture: watched ? () => <FeedPicture feedKey={streamKey(accountId, watching.streamKey)} /> : undefined,
        // This account can be signed in here and in Discord's own client at
        // once, and then the stream is this account's and there is nothing
        // here to open.
        action: m.isSelf
          ? undefined
          : {
              label: 'Watch stream',
              onClick: () => void store.watchDiscordStream(accountId, m.userId, m.nick, { channelId, guildId: session.guildId })
            },
        dismiss: watched ? { label: 'Stop watching', onClick: () => void store.stopWatchingDiscordStream() } : undefined
      })
    }
  }

  const buttons: StageButton[] = [
    {
      icon: voicePrefs.micMuted ? 'mic_off' : 'mic',
      label: voicePrefs.micMuted ? 'Unmute' : 'Mute',
      off: voicePrefs.micMuted,
      onClick: () => void store.setVoiceMuted({ micMuted: !voicePrefs.micMuted })
    },
    {
      icon: voicePrefs.deafened ? 'headset_off' : 'headset_mic',
      label: voicePrefs.deafened ? 'Undeafen' : 'Deafen',
      off: voicePrefs.deafened,
      onClick: () => void store.setVoiceMuted({ deafened: !voicePrefs.deafened })
    },
    {
      icon: sharing ? 'stop_screen_share' : 'screen_share',
      label: sharing ? 'Stop sharing' : 'Share your screen',
      active: sharing,
      onClick: () => void store.toggleScreenShare()
    },
    { icon: 'call_end', label: 'Disconnect', danger: true, onClick: () => void store.leaveVoice(accountId) }
  ]

  const buffer = buffers.find((b) => b.id === session.bufferId)
  const title = session.isDirect ? `Call with ${buffer?.name ?? 'this conversation'}` : session.channelName
  return (
    <Stage
      title={title}
      subtitle={members.length > 0 ? `${members.length} in the call` : 'Connecting…'}
      tiles={tiles}
      buttons={buttons}
      where={where}
      onPopOut={() => store.setCallPoppedOut(true)}
      onBringBack={() => store.setCallPoppedOut(false)}
    />
  )
}
