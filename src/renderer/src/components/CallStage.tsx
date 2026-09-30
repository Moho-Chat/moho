import { useEffect, useRef, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { VideoStage } from './VideoStage'
import { Stage, fitTiles, type StageButton, type StageTile } from './stage/Stage'
import { Avatar } from './Avatar'
import { useChat, useStore } from '../state/hooks'
import type { CallTile } from '../state/store'
import { bufferDisplayName, classes } from '../lib/util'

/**
 * A call with pictures in it, over the conversation it belongs to.
 *
 * Two tiles: the other end large, and this end small in the corner - the
 * arrangement every video call has settled on, because the person you are
 * looking at is the one you are talking to and the picture of yourself is
 * only there to check you are in frame.
 *
 * Above the log rather than instead of it, for the reason the voice call view
 * gives: a call and the conversation it is in are the same conversation, and
 * people type links into a channel while talking in it.
 *
 * Deliberately not Matrix-shaped. It draws two streams and a row of buttons,
 * which is what a call is on any service - the screen-share button here is the
 * same button Discord's will be, and the tiles are the same tiles.
 */
export { fitTiles } from './stage/Stage'

/** The gap between tiles in the corner player. */
const TILE_GAP = 6

export function CallStage({ mode = 'inline' }: { mode?: 'inline' | 'pip' | 'window' }): JSX.Element | null {
  const store = useStore()
  const call = useChat((s) => s.activeCall)
  const minimized = useChat((s) => s.callMinimized)
  const poppedOut = useChat((s) => s.callPoppedOut)
  const buffers = useChat((s) => s.buffers)
  const videos = useRef(new Map<string, HTMLVideoElement>())
  const grid = useRef<HTMLDivElement>(null)
  const [tiles, setTiles] = useState<CallTile[]>([])
  /** How wide the corner player's grid is, which decides its layout. */
  const [room, setRoom] = useState({ width: 320, height: 180 })
  /** Whose picture the corner player is showing large, if anybody. */
  const [focused, setFocused] = useState<string | null>(null)

  useEffect(() => {
    const el = grid.current
    if (!el || mode !== 'pip') return
    const measure = (): void => setRoom({ width: el.clientWidth, height: Math.min(window.innerHeight * 0.3, 260) })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [mode, minimized])

  // The streams are not state: they are live objects whose tracks change under
  // a call - somebody turning a camera on, somebody starting to share - so the
  // elements are pointed at them rather than re-rendered from them. Every
  // element showing a person is kept pointed at their stream, however many
  // places they are drawn at once.
  useEffect(() => {
    if (!call) return
    const attach = (): void => {
      const current = store.callTiles()
      setTiles((was) =>
        was.length === current.length &&
        was.every(
          (t, i) =>
            t.id === current[i].id &&
            t.hasVideo === current[i].hasVideo &&
            t.speaking === current[i].speaking &&
            t.muted === current[i].muted
        )
          ? was
          : current
      )
      for (const tile of current) {
        for (const [key, el] of videos.current) {
          if (key.startsWith(`${tile.id}#`) && tile.stream && el.srcObject !== tile.stream) el.srcObject = tile.stream
        }
      }
    }
    attach()
    const timer = setInterval(attach, 300)
    return () => clearInterval(timer)
  }, [call, store])

  if (!call) return null

  // In a window of its own: the conversation keeps a line saying so, and the
  // corner keeps nothing.
  if (mode !== 'window' && poppedOut) {
    if (mode === 'pip') return null
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

  const where = buffers.find((b) => b.id === call.bufferId)?.name ?? ''
  const phase =
    call.phase === 'ringing' ? 'Ringing…' : call.phase === 'connecting' ? 'Connecting…' : 'Connected'

  /**
   * A video element for one person in one place. Always muted: the call's
   * sound is played once, by CallAudio, not by every picture of every person
   * - two pictures of one person would otherwise be two voices.
   */
  const video = (tile: CallTile, slot: string, className: string): JSX.Element => (
    <video
      ref={(el) => {
        const key = `${tile.id}#${slot}`
        if (el) {
          videos.current.set(key, el)
          if (tile.stream && el.srcObject !== tile.stream) el.srcObject = tile.stream
        } else videos.current.delete(key)
      }}
      className={className}
      autoPlay
      playsInline
      muted
    />
  )

  const buttons: StageButton[] = [
    {
      icon: call.muted ? 'mic_off' : 'mic',
      label: call.muted ? 'Unmute' : 'Mute',
      off: call.muted,
      onClick: () => store.toggleCallMute()
    },
    {
      icon: call.cameraOn ? 'videocam' : 'videocam_off',
      label: call.cameraOn ? 'Turn the camera off' : 'Turn the camera on',
      off: !call.cameraOn,
      onClick: () => void store.toggleCamera()
    },
    {
      icon: call.sharingScreen ? 'stop_screen_share' : 'screen_share',
      label: call.sharingScreen ? 'Stop sharing' : 'Share your screen',
      active: call.sharingScreen,
      onClick: () => void store.toggleScreenShare()
    },
    { icon: 'call_end', label: 'Hang up', danger: true, onClick: () => store.hangUpMatrixCall() }
  ]

  if (mode !== 'pip') {
    const stageTiles: StageTile[] = tiles.map((tile) => ({
      id: tile.id,
      name: tile.label,
      speaking: tile.speaking,
      muted: tile.muted,
      picture: tile.hasVideo ? (slot) => video(tile, slot, 'stage-picture') : undefined
    }))
    return (
      <Stage
        title={bufferDisplayName(where) || 'Call'}
        subtitle={phase}
        tiles={stageTiles}
        buttons={buttons}
        where={mode}
        onPopOut={() => store.setCallPoppedOut(true)}
        onBringBack={() => store.setCallPoppedOut(false)}
      />
    )
  }

  // The corner player, for a call you have walked away from.
  const stage = tiles.find((t) => t.id === focused) ?? null
  const layout = fitTiles(Math.max(tiles.length, 1), room.width, room.height)
  const stripHeight = 42
  const stageFit = fitTiles(1, room.width, room.height - (tiles.length > 1 ? stripHeight + TILE_GAP : 0), Infinity)
  const everybody = tiles.map((t) => t.label).join(', ')

  const drawTile = (
    tile: CallTile,
    slot: 'stage' | 'strip',
    opts: { width?: number; onClick: () => void }
  ): JSX.Element => (
    <button
      key={`${tile.id}#${slot}`}
      type="button"
      className={classes('video-tile', tile.speaking && 'speaking', slot === 'strip' && 'small-tile')}
      style={opts.width ? { width: `${opts.width}px` } : undefined}
      title={stage?.id === tile.id ? 'Back to everybody' : `Look at ${tile.label}`}
      onClick={opts.onClick}
    >
      {video(tile, `pip-${slot}`, classes('video-tile-picture', !tile.hasVideo && 'audio-only'))}
      {!tile.hasVideo && (
        <div className="video-tile-face">
          <Avatar name={tile.label} size={slot === 'strip' ? 24 : 32} />
        </div>
      )}
      {slot !== 'strip' && (
        <span className="video-tile-name small ellipsis">
          {tile.muted && <Icon name="mic_off" size={12} />}
          {tile.label}
        </span>
      )}
    </button>
  )

  return (
    <VideoStage
      mode="pip"
      title={everybody}
      subtitle={`${phase}${where ? ` · ${bufferDisplayName(where)}` : ''}`}
      minimized={minimized}
      onMinimized={(m) => store.setCallMinimized(m)}
      onGoTo={() => void store.selectBuffer(call.bufferId)}
      onEnd={() => store.hangUpMatrixCall()}
      endLabel="Hang up"
      controls={
        <>
          {buttons.slice(0, 3).map((b) => (
            <IconButton
              key={b.label}
              name={b.icon}
              title={b.label}
              className={b.active ? 'active' : b.off ? 'calling' : undefined}
              onClick={b.onClick}
            />
          ))}
          <IconButton name="open_in_new" title="Pop out into its own window" onClick={() => store.setCallPoppedOut(true)} />
        </>
      }
    >
      {stage ? (
        <div className="video-stage" ref={grid}>
          {drawTile(stage, 'stage', { width: Math.floor(stageFit.tileWidth), onClick: () => setFocused(null) })}
          {tiles.length > 1 && (
            <div className="video-strip" style={{ height: `${stripHeight}px` }}>
              {tiles
                .filter((t) => t.id !== stage.id)
                .map((tile) =>
                  drawTile(tile, 'strip', { width: Math.round((stripHeight * 16) / 9), onClick: () => setFocused(tile.id) })
                )}
            </div>
          )}
        </div>
      ) : (
        <div
          className="video-grid"
          ref={grid}
          style={{ gridTemplateColumns: `repeat(${layout.columns}, ${Math.floor(layout.tileWidth)}px)` }}
        >
          {tiles.map((tile) => drawTile(tile, 'stage', { onClick: () => setFocused(tile.id) }))}
        </div>
      )}
    </VideoStage>
  )
}

/**
 * The call's sound: one hidden element per other person, in the main window.
 *
 * Kept apart from the pictures so that where the call is drawn - over the
 * conversation, in the corner, in a window of its own - never decides whether
 * it can be heard, and so that a person drawn twice is heard once.
 */
export function CallAudio(): JSX.Element | null {
  const store = useStore()
  const call = useChat((s) => s.activeCall)
  const [people, setPeople] = useState<CallTile[]>([])
  const sinks = useRef(new Map<string, HTMLAudioElement>())

  useEffect(() => {
    if (!call) return
    const attach = (): void => {
      const others = store.callTiles().filter((t) => !t.self)
      setPeople((was) => (was.length === others.length && was.every((t, i) => t.id === others[i].id) ? was : others))
      for (const tile of others) {
        const el = sinks.current.get(tile.id)
        if (el && tile.stream && el.srcObject !== tile.stream) el.srcObject = tile.stream
      }
    }
    attach()
    const timer = setInterval(attach, 500)
    return () => clearInterval(timer)
  }, [call, store])

  if (!call) return null
  return (
    <>
      {people.map((tile) => (
        <audio
          key={tile.id}
          autoPlay
          ref={(el) => {
            if (el) {
              sinks.current.set(tile.id, el)
              if (tile.stream && el.srcObject !== tile.stream) el.srcObject = tile.stream
            } else sinks.current.delete(tile.id)
          }}
        />
      ))}
    </>
  )
}

/**
 * A call already happening in this room, and the way into it.
 *
 * A group call has no invitation: it is a piece of room state saying people
 * are in one, so the only way anybody learns of it is by being shown that
 * they could join. Which is what this is - the bar Element shows at the top
 * of a room, in the place a call would appear.
 */
export function RoomCallBar({ bufferId }: { bufferId: string }): JSX.Element | null {
  const store = useStore()
  const members = useChat((s) => s.callMembers[bufferId]) ?? []
  const activeCall = useChat((s) => s.activeCall)
  const buffers = useChat((s) => s.buffers)

  // Nothing to offer while this end is already in it, and nothing to offer
  // when nobody is.
  if (members.length === 0 || activeCall?.bufferId === bufferId) return null
  // Whose account this is, out of its id: a Matrix account is named for the
  // user it signs in as, and this end being in the call from another device
  // is still this end being in it.
  const accountId = buffers.find((b) => b.id === bufferId)?.accountId ?? ''
  const ownUserId = accountId.startsWith('matrix:') ? accountId.slice('matrix:'.length) : accountId
  const others = members.filter((m) => m.user_id !== ownUserId)
  if (others.length === 0) return null

  const who =
    others.length === 1
      ? `${others[0].user_id} is in a call`
      : `${others.length} people are in a call`

  // Where the call is held, which is worth saying: on a media server it is
  // the same call Element's people are in, and on the mesh it is one between
  // whoever is in the room.
  const onServer = members.some((m) => m.transports?.includes('livekit'))

  return (
    <div className="room-call-bar">
      <Icon name="videocam" size={16} />
      <span className="small ellipsis">
        {who}
        {onServer ? ' · on a media server' : ''}
      </span>
      <button type="button" className="button" onClick={() => void store.joinMatrixGroupCall(bufferId, false)}>
        Join
      </button>
      <button type="button" className="button" onClick={() => void store.joinMatrixGroupCall(bufferId, true)}>
        Join with video
      </button>
    </div>
  )
}

/**
 * Which screen or window to show the room.
 *
 * A grid of what is actually open, with a still of each, because the names
 * alone do not distinguish two browser windows - and showing the wrong window
 * to a room is the mistake this dialog exists to prevent.
 */
export function ScreenPicker(): JSX.Element | null {
  const store = useStore()
  const sources = useChat((s) => s.screenSources)
  if (!sources) return null

  return (
    <div className="lightbox-backdrop" onClick={() => store.chooseScreenSource(null)}>
      <div className="screen-picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="screen-picker-head">
          <span>Share a screen or window</span>
          <IconButton name="close" size={16} title="Cancel" onClick={() => store.chooseScreenSource(null)} />
        </div>
        <div className="screen-picker-grid">
          {sources.map((source) => (
            <button
              key={source.id}
              type="button"
              className="screen-source"
              onClick={() => store.chooseScreenSource({ id: source.id, name: source.name })}
            >
              <img src={source.thumbnail} alt="" />
              <span className="small ellipsis">{source.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Somebody ringing, and the two answers.
 *
 * Its own panel rather than a line in the log, because a call is answered in
 * the seconds it is offered and a message that scrolls is not an offer. Two
 * ways in, because an offer with a camera and one without are different
 * things to accept - and answering a video call with audio only is a thing
 * people do on purpose.
 */
export function IncomingMatrixCall(): JSX.Element | null {
  const store = useStore()
  const ringing = useChat((s) => s.ringingCall)
  const buffers = useChat((s) => s.buffers)
  if (!ringing) return null

  const where = buffers.find((b) => b.id === ringing.bufferId)?.name ?? ''

  return (
    <div className="incoming-calls">
      <div className="incoming-call">
        <Icon name={ringing.video ? 'videocam' : 'call'} size={18} />
        <span className="ellipsis">
          {ringing.from} is calling{where ? ` in ${where}` : ''}
        </span>
        <button type="button" className="button" onClick={() => void store.answerMatrixCall(false)}>
          Answer
        </button>
        {ringing.video && (
          <button type="button" className="button" onClick={() => void store.answerMatrixCall(true)}>
            With video
          </button>
        )}
        <button type="button" className="button danger" onClick={() => store.declineMatrixCall()}>
          Decline
        </button>
      </div>
    </div>
  )
}
