import { useEffect, useRef, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { VideoStage } from './VideoStage'
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
/** Sixteen by nine, which is what cameras and screens both are. */
const TILE_RATIO = 16 / 9
/** No tile gets bigger than this, however much room there is. */
const TILE_MAX = 420
const TILE_GAP = 6

/**
 * How to lay out a call of this size in the space there is.
 *
 * Every column count is tried and the one that makes the tiles biggest wins,
 * subject to them all fitting - which is what a grid of faces should do and
 * what a fixed table of counts cannot: three people in a wide short box want
 * one row, and the same three in a tall narrow one want three.
 *
 * Capped, because a call between two people on a large screen should not be
 * two enormous windows - past a certain size a face stops being easier to
 * read and the conversation underneath just disappears.
 */
export function fitTiles(
  count: number,
  width: number,
  height: number,
  max: number = TILE_MAX
): { columns: number; tileWidth: number } {
  if (count < 1 || width < 1) return { columns: 1, tileWidth: 0 }
  let best = { columns: 1, tileWidth: 0 }
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns)
    // What the width allows, and what the height allows; the smaller governs.
    const byWidth = (width - TILE_GAP * (columns - 1)) / columns
    const byHeight = ((height - TILE_GAP * (rows - 1)) / rows) * TILE_RATIO
    const tileWidth = Math.min(byWidth, byHeight, max)
    if (tileWidth > best.tileWidth) best = { columns, tileWidth }
  }
  return best
}

export function CallStage({ mode = 'inline' }: { mode?: 'inline' | 'pip' }): JSX.Element | null {
  const store = useStore()
  const call = useChat((s) => s.activeCall)
  const minimized = useChat((s) => s.callMinimized)
  const buffers = useChat((s) => s.buffers)
  const videos = useRef(new Map<string, HTMLVideoElement>())
  const grid = useRef<HTMLDivElement>(null)
  const [tiles, setTiles] = useState<CallTile[]>([])
  /** How wide the grid is, which decides how the tiles are laid out. */
  const [room, setRoom] = useState({ width: 640, height: 260 })
  /**
   * Whose picture is being looked at, if anybody.
   *
   * Null is the grid, where nobody is more important than anybody else. Naming
   * one person is a decision the person watching made, so it is undone the
   * same way it was made rather than by anything the call does.
   */
  const [focused, setFocused] = useState<string | null>(null)

  // Measured rather than assumed: the same call is a different shape in a
  // narrow window, in a full-screen one, and in the corner it retreats to.
  useEffect(() => {
    const el = grid.current
    if (!el) return
    const measure = (): void =>
      setRoom({
        width: el.clientWidth,
        // As much height as a call may take before it is taking over the
        // conversation rather than sitting above it.
        height: Math.min(window.innerHeight * (mode === 'pip' ? 0.3 : 0.45), mode === 'pip' ? 260 : 460)
      })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [mode, minimized])

  // The streams are not state: they are live objects whose tracks change under
  // a call - somebody turning a camera on, somebody starting to share - so the
  // elements are pointed at them rather than re-rendered from them.
  useEffect(() => {
    if (!call) return
    const attach = (): void => {
      const current = store.callTiles()
      setTiles((was) =>
        was.length === current.length && was.every((t, i) => t.id === current[i].id && t.hasVideo === current[i].hasVideo)
          ? was
          : current
      )
      // Both slots: in the focused layout the same person is on the stage and
      // in the strip underneath, which is two elements showing one stream.
      for (const tile of current) {
        for (const slot of ['stage', 'strip']) {
          const el = videos.current.get(`${tile.id}#${slot}`)
          if (el && tile.stream && el.srcObject !== tile.stream) el.srcObject = tile.stream
        }
      }
    }
    attach()
    const timer = setInterval(attach, 700)
    return () => clearInterval(timer)
  }, [call, store])

  if (!call) return null

  const where = buffers.find((b) => b.id === call.bufferId)?.name ?? ''
  // Somebody who has left the call cannot go on being the one looked at.
  const stage = tiles.find((t) => t.id === focused) ?? null
  const layout = fitTiles(Math.max(tiles.length, 1), room.width, room.height)
  /** The row of everybody else under the stage, and how tall it is. */
  const stripHeight = mode === 'pip' ? 42 : 74
  const stageFit = fitTiles(
    1,
    room.width,
    room.height - (tiles.length > 1 ? stripHeight + TILE_GAP : 0),
    // Uncapped: the whole point of picking somebody out is to see them larger
    // than the grid would ever draw them.
    Infinity
  )
  const phase =
    call.phase === 'ringing' ? 'Ringing…' : call.phase === 'connecting' ? 'Connecting…' : 'Connected'

  // Who is in it, named. Only in the corner: in the conversation the tiles are
  // large enough to read the names off, and a second list of them would be the
  // same information twice.
  const everybody = tiles.map((t) => t.label).join(', ')

  /**
   * One person's tile, wherever it is being drawn.
   *
   * A button rather than a div with a click on it: it is a control now, so it
   * is reached by keyboard and says what it does to anything reading the
   * window out loud.
   */
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
      <video
        ref={(el) => {
          if (el) videos.current.set(`${tile.id}#${slot}`, el)
          else videos.current.delete(`${tile.id}#${slot}`)
        }}
        className={classes('video-tile-picture', !tile.hasVideo && 'audio-only')}
        autoPlay
        playsInline
        // Our own microphone coming back would be the oldest mistake in video
        // calling.
        muted={tile.self}
      />
      {!tile.hasVideo && (
        <div className="video-tile-face">
          <Avatar name={tile.label} size={slot === 'strip' ? 24 : mode === 'pip' ? 32 : 44} />
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
      mode={mode}
      title={everybody}
      subtitle={`${phase}${where ? ` · ${bufferDisplayName(where)}` : ''}`}
      minimized={minimized}
      onMinimized={(m) => store.setCallMinimized(m)}
      onGoTo={() => void store.selectBuffer(call.bufferId)}
      onEnd={() => store.hangUpMatrixCall()}
      endLabel="Hang up"
      controls={
        <>
          <IconButton
            name={call.muted ? 'mic_off' : 'mic'}
            title={call.muted ? 'Unmute' : 'Mute'}
            className={call.muted ? 'calling' : undefined}
            onClick={() => store.toggleCallMute()}
          />
          <IconButton
            name={call.sharingScreen ? 'stop_screen_share' : 'screen_share'}
            title={call.sharingScreen ? 'Stop sharing' : 'Share a screen or window'}
            className={call.sharingScreen ? 'active' : undefined}
            onClick={() => void store.toggleScreenShare()}
          />
        </>
      }
    >
      {/* Everybody in the call, one tile each, in as square a grid as the
          number allows - which is what every client with more than two people
          in a call has arrived at, because faces are roughly square and a row
          of six is six unreadable slivers.

          Not a big-one-and-a-strip layout by default: that decides for
          somebody which person matters, and in a conversation between five
          people it is wrong most of the time. Pressing a face is how that
          decision gets made, and pressing it again is how it is unmade. */}
      {stage ? (
        <div className="video-stage" ref={grid}>
          {drawTile(stage, 'stage', {
            width: Math.floor(stageFit.tileWidth),
            onClick: () => setFocused(null)
          })}
          {tiles.length > 1 && (
            /* Everybody else, still there and still watchable: a call does not
               become a broadcast because one person is being looked at. */
            <div className="video-strip" style={{ height: `${stripHeight}px` }}>
              {tiles
                .filter((t) => t.id !== stage.id)
                .map((tile) =>
                  drawTile(tile, 'strip', {
                    width: Math.round((stripHeight * 16) / 9),
                    onClick: () => setFocused(tile.id)
                  })
                )}
            </div>
          )}
        </div>
      ) : (
        <div
          className="video-grid"
          ref={grid}
          style={{
            gridTemplateColumns: `repeat(${layout.columns}, ${Math.floor(layout.tileWidth)}px)`
          }}
        >
          {tiles.map((tile) => drawTile(tile, 'stage', { onClick: () => setFocused(tile.id) }))}
        </div>
      )}

    </VideoStage>
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

  // A call held on a media server - which is what Element's own calls are.
  // moho can see who is in one and cannot be in it yet, so it says so here
  // rather than offering a button that fails.
  const needsFocus = members.some((m) => m.transports?.includes('livekit'))

  return (
    <div className="room-call-bar">
      <Icon name="videocam" size={16} />
      <span className="small ellipsis">
        {who}
        {needsFocus ? ' · through a media server moho cannot join yet' : ''}
      </span>
      {!needsFocus && (
        <>
          <button type="button" className="button" onClick={() => void store.joinMatrixGroupCall(bufferId, false)}>
            Join
          </button>
          <button type="button" className="button" onClick={() => void store.joinMatrixGroupCall(bufferId, true)}>
            Join with video
          </button>
        </>
      )}
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
