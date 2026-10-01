import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { Stage, type StageButton, type StageTile } from './stage/Stage'
import { FeedPicture } from './stage/FeedPicture'
import { cameraKey, streamKey } from '../lib/framefeed'
import type { VideoQuality } from '../lib/discordscreen'
import { usePref } from '../state/hooks'
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
  const sharing = useChat((s) => s.discordSharing) === session.accountId
  const myCamera = useChat((s) => s.discordCamera)
  // Only this call's account: one window can be in two accounts' calls.
  const ownCamera = myCamera?.accountId === session.accountId ? myCamera.stream : null
  const [choosing, setChoosing] = useState(false)
  /** Which of the stage's two small panels is open: the call's volume, or the soundboard. */
  const [panel, setPanel] = useState<'volume' | 'soundboard' | null>(null)
  const shareStream = useChat((s) => s.discordShareStream)
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

  // A stage is listened to, mostly. Only the speakers get tiles - an
  // audience can be hundreds, and a grid of them would bury the people
  // talking - and the audience is counted instead.
  const stage = !!session.stage
  const me = members.find((m) => m.isSelf)
  const onStage = stage ? members.filter((m) => !m.suppressed) : members
  const audience = stage ? members.length - onStage.length : 0

  const tiles: StageTile[] = []
  for (const m of onStage) {
    const camera = cameras[`${accountId}|${m.userId}`]
    tiles.push({
      id: m.userId,
      name: m.isSelf ? `${m.nick} (you)` : m.nick,
      avatarUrl: m.avatarUrl,
      speaking: m.isSelf ? speaking.self !== undefined : (speaking[m.userId] ?? 0) > 0,
      muted: m.muted,
      deafened: m.deafened,
      // Your own camera is drawn from the capture rather than from the
      // call: Discord does not send a picture back to the one sending it.
      picture:
        m.isSelf && ownCamera
          ? () => <LocalPicture stream={ownCamera} />
          : camera
            ? () => <FeedPicture feedKey={cameraKey(accountId, m.userId)} />
            : undefined,
      // Everybody but you can be turned up or down from their own
      // right-click menu, as in Discord, and it holds across calls.
      menu: m.isSelf
        ? undefined
        : [
            {
              slider: true,
              label: 'User Volume',
              value: Math.round((voicePrefs.userVolumes?.[m.userId] ?? 1) * 100),
              min: 0,
              max: 200,
              step: 5,
              format: (v) => `${v}%`,
              onChange: (v) => store.setVoiceVolume(v / 100, m.userId)
            },
            { separator: true },
            {
              label: 'Copy User ID',
              icon: 'badge',
              onClick: () => void navigator.clipboard.writeText(m.userId).catch(() => {})
            }
          ],
      volumeBadge: volumeBadge(voicePrefs.userVolumes?.[m.userId])
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
        // Your own share drawn from the capture itself: the one way to see
        // the right window was picked and that it is still moving, without
        // asking somebody watching.
        picture:
          m.isSelf && sharing && shareStream
            ? () => <LocalPicture stream={shareStream} mirrored={false} />
            : watched
              ? () => <FeedPicture feedKey={streamKey(accountId, watching.streamKey)} />
              : undefined,
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

  // From this call's own account. The window can be in two accounts' calls,
  // and asking the store for "the" Discord call picks whichever came first.
  const share = (quality?: VideoQuality): Promise<void> =>
    store.toggleDiscordScreenShare(accountId, session.bufferId, quality)

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
      icon: ownCamera ? 'videocam' : 'videocam_off',
      label: ownCamera ? 'Turn the camera off' : 'Turn the camera on',
      off: !ownCamera,
      onClick: () => void store.toggleDiscordCamera(accountId)
    },
    {
      icon: sharing ? 'stop_screen_share' : 'screen_share',
      label: sharing ? 'Stop sharing' : 'Share your screen',
      active: sharing,
      // Stopping needs no questions; starting asks how good a stream, the
      // way Discord's own client does, beside the button that asked.
      onClick: () => (sharing ? void share() : setChoosing(!choosing)),
      popover:
        choosing && !sharing ? (
          <GoLiveChooser
            accountId={accountId}
            onStart={(quality) => {
              setChoosing(false)
              void share(quality)
            }}
            onClose={() => setChoosing(false)}
          />
        ) : null
    },
    // The whole call's loudness, on the call rather than in Settings: it is
    // changed while listening, by somebody who should not have to leave the
    // call to do it.
    {
      icon: (voicePrefs.outputVolume ?? 1) === 0 ? 'volume_off' : (voicePrefs.outputVolume ?? 1) < 1 ? 'volume_down' : 'volume_up',
      label: 'Call volume',
      active: panel === 'volume',
      onClick: () => setPanel(panel === 'volume' ? null : 'volume'),
      popover:
        panel === 'volume' ? (
          <StagePanel onClose={() => setPanel(null)} label="Call volume">
            <div className="call-volume-panel">
              <span className="small muted">Call volume</span>
              <input
                type="range"
                min={0}
                max={200}
                step={5}
                value={Math.round((voicePrefs.outputVolume ?? 1) * 100)}
                aria-label="Call volume"
                onChange={(e) => store.setVoiceVolume(Number(e.target.value) / 100)}
              />
              <span className="call-volume-value">{Math.round((voicePrefs.outputVolume ?? 1) * 100)}%</span>
            </div>
          </StagePanel>
        ) : null
    },
    // Sounds anybody in a guild's voice channel can set off. Not in a one-to-
    // one call, which Discord gives no soundboard.
    ...(session.guildId
      ? [
          {
            icon: 'graphic_eq',
            label: 'Soundboard',
            active: panel === 'soundboard',
            onClick: () => setPanel(panel === 'soundboard' ? null : 'soundboard'),
            popover:
              panel === 'soundboard' ? (
                <StagePanel onClose={() => setPanel(null)} label="Soundboard">
                  <Soundboard accountId={accountId} />
                </StagePanel>
              ) : null
          }
        ]
      : []),
    // A stage's own two controls. In the audience: put a hand up, and once
    // it is up - yours, or a moderator inviting you - step onto the stage.
    // On the stage: step back down. Discord refuses a step up nobody allowed,
    // and says so.
    ...(stage && me && session.guildId
      ? me.suppressed
        ? [
            {
              icon: 'front_hand',
              label: me.handRaised ? 'Lower your hand' : 'Ask to speak',
              active: !!me.handRaised,
              onClick: () => void store.setStageHand(accountId, session.guildId!, channelId, !me.handRaised)
            },
            ...(me.handRaised
              ? [
                  {
                    icon: 'podium',
                    label: 'Step onto the stage',
                    onClick: () => void store.setStageSpeaker(accountId, session.guildId!, channelId, true)
                  }
                ]
              : [])
          ]
        : [
            {
              icon: 'podium',
              label: 'Move to the audience',
              active: true,
              onClick: () => void store.setStageSpeaker(accountId, session.guildId!, channelId, false)
            }
          ]
      : []),
    { icon: 'call_end', label: 'Disconnect', danger: true, onClick: () => void store.leaveVoice(accountId) }
  ]

  const buffer = buffers.find((b) => b.id === session.bufferId)
  const title = session.isDirect ? `Call with ${buffer?.name ?? 'this conversation'}` : session.channelName
  return (
    <Stage
      title={title}
      subtitle={
        members.length === 0
          ? 'Connecting…'
          : stage
            ? `${onStage.length} on stage · ${audience} listening${me?.suppressed ? ' · you are in the audience' : ''}`
            : `${members.length} in the call`
      }
      tiles={tiles}
      buttons={buttons}
      where={where}
      onPopOut={() => store.setCallPoppedOut(true)}
      onBringBack={() => store.setCallPoppedOut(false)}
    />
  )
}

/**
 * Something this end is sending, from the capture: a camera mirrored, as a
 * mirror is, and a screen as it is.
 */
function LocalPicture({ stream, mirrored = true }: { stream: MediaStream; mirrored?: boolean }): JSX.Element {
  return (
    <video
      ref={(el) => {
        if (el && el.srcObject !== stream) el.srcObject = stream
      }}
      className={mirrored ? 'stage-picture mirrored' : 'stage-picture'}
      autoPlay
      playsInline
      muted
    />
  )
}

const HEIGHTS: (number | 'source')[] = [480, 720, 1080, 1440, 'source']
const FRAMERATES = [15, 30, 60]

/**
 * How good a stream to send: resolution and frame rate.
 *
 * Asked each time, because the right answer depends on what is shared -
 * text wants resolution, a game wants frames, a thin connection wants
 * neither - and remembered, because it is usually the same answer as last
 * time. Only what the account's tier allows is offered: Discord holds an
 * account without Nitro to 720p30, and its own client offers nothing above.
 */
function GoLiveChooser({
  accountId,
  onStart,
  onClose
}: {
  accountId: string
  onStart: (quality: VideoQuality) => void
  onClose: () => void
}): JSX.Element {
  const [limits, setLimits] = useState<{ maxHeight: number; maxFramerate: number; source: boolean } | null>(null)
  const [height, setHeight] = usePref<number | 'source'>('discord.streamHeight', 720)
  const [framerate, setFramerate] = usePref<number>('discord.streamFramerate', 30)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.moho
      .rpc<{ maxHeight: number; maxFramerate: number; source: boolean }>('discordStreamLimits', { accountId })
      .then(setLimits)
      .catch(() => setLimits({ maxHeight: 720, maxFramerate: 30, source: false }))
  }, [accountId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // A press anywhere else is a change of mind. Except on the button that
    // opened this, which closes it by itself and would otherwise reopen it.
    const onDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (box.current?.contains(target) || target.closest('.stage-button')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const heights = HEIGHTS.filter((h) => (h === 'source' ? !!limits?.source : h <= (limits?.maxHeight ?? 720)))
  const rates = FRAMERATES.filter((r) => r <= (limits?.maxFramerate ?? 30))
  // A remembered choice above what this account may send falls back to the
  // best it may.
  const chosenHeight = heights.includes(height) ? height : heights[heights.length - 1]
  const chosenRate = rates.includes(framerate) ? framerate : rates[rates.length - 1]

  return (
    <div className="go-live" ref={box} role="dialog" aria-label="Stream quality">
      <div className="go-live-row">
        <span className="small muted">Resolution</span>
        <div className="segmented">
          {heights.map((h) => (
            <button
              key={String(h)}
              type="button"
              className={h === chosenHeight ? 'active' : ''}
              onClick={() => setHeight(h)}
            >
              {h === 'source' ? 'Source' : `${h}p`}
            </button>
          ))}
        </div>
      </div>
      <div className="go-live-row">
        <span className="small muted">Frame rate</span>
        <div className="segmented">
          {rates.map((r) => (
            <button key={r} type="button" className={r === chosenRate ? 'active' : ''} onClick={() => setFramerate(r)}>
              {r} fps
            </button>
          ))}
        </div>
      </div>
      {limits && !limits.source && limits.maxHeight <= 720 && (
        <p className="small muted go-live-note">Higher than 720p30 needs Nitro on this account.</p>
      )}
      <button
        type="button"
        className="button primary"
        disabled={!limits}
        onClick={() => onStart({ height: chosenHeight, framerate: chosenRate })}
      >
        Go live
      </button>
    </div>
  )
}

/** A volume worth showing on a tile: anything but 100%. */
function volumeBadge(volume: number | undefined): string | undefined {
  if (volume === undefined || Math.abs(volume - 1) < 0.005) return undefined
  return `${Math.round(volume * 100)}%`
}

/**
 * A small panel above a stage button, closed by Escape or a press anywhere
 * else - except on the stage's buttons, which open and close it themselves.
 */
function StagePanel({ onClose, label, children }: { onClose: () => void; label: string; children: React.ReactNode }): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (box.current?.contains(target) || target.closest('.stage-button')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])
  return (
    <div className="stage-panel" ref={box} role="dialog" aria-label={label}>
      {children}
    </div>
  )
}

interface SoundboardSound {
  id: string
  name: string
  group: string
  guildId?: string
  emojiName?: string
  emojiId?: string
  locked: boolean
}

/**
 * The soundboard: everything this account can play here, grouped as Discord
 * groups it - this server's own, Discord's defaults, then the others, which
 * need Nitro. Pressing one plays it to the whole channel, this end included.
 */
function Soundboard({ accountId }: { accountId: string }): JSX.Element {
  const store = useStore()
  const [sounds, setSounds] = useState<SoundboardSound[] | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    void window.moho
      .rpc<SoundboardSound[]>('listSoundboard', { accountId })
      .then(setSounds)
      .catch(() => setSounds([]))
  }, [accountId])

  const q = query.trim().toLowerCase()
  const groups = new Map<string, SoundboardSound[]>()
  for (const s of sounds ?? []) {
    if (q && !s.name.toLowerCase().includes(q)) continue
    groups.set(s.group, [...(groups.get(s.group) ?? []), s])
  }

  const play = (s: SoundboardSound): void => {
    void window.moho
      .rpc('playSoundboard', { accountId, soundId: s.id, guildId: s.guildId })
      .catch((e: Error) => store.toast('error', `Couldn't play ${s.name}: ${e.message}`))
  }

  return (
    <div className="soundboard">
      <div className="emoji-search">
        <Icon name="search" size={16} />
        <input autoFocus placeholder="Find a sound" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="soundboard-list">
        {sounds === null && <p className="small muted">Loading…</p>}
        {sounds !== null && groups.size === 0 && <p className="small muted">{q ? 'No matches.' : 'No sounds here.'}</p>}
        {[...groups.entries()].map(([group, list]) => (
          <div key={group}>
            <div className="emoji-section small muted">{group}</div>
            <div className="soundboard-grid">
              {list.map((s) => (
                <button
                  key={`${group}:${s.id}`}
                  type="button"
                  className="soundboard-sound"
                  disabled={s.locked}
                  title={s.locked ? `${s.name} - needs Nitro outside its own server` : s.name}
                  onClick={() => play(s)}
                >
                  {s.emojiId ? (
                    <img src={`https://cdn.discordapp.com/emojis/${s.emojiId}.webp?size=32`} alt="" />
                  ) : s.emojiName ? (
                    <span className="soundboard-emoji">{s.emojiName}</span>
                  ) : (
                    <Icon name="music_note" size={16} />
                  )}
                  <span className="ellipsis">{s.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
