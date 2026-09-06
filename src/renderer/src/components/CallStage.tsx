import { useEffect, useRef, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { useChat, useStore } from '../state/hooks'
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
export function CallStage(): JSX.Element | null {
  const store = useStore()
  const call = useChat((s) => s.activeCall)
  const buffers = useChat((s) => s.buffers)
  const localVideo = useRef<HTMLVideoElement>(null)
  const remoteVideo = useRef<HTMLVideoElement>(null)
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false)

  // The streams are not state: they are live objects that change tracks under
  // a call, so the elements are pointed at them rather than re-rendered from
  // them.
  useEffect(() => {
    if (!call) return
    const attach = (): void => {
      const { local, remote } = store.callStreams()
      if (localVideo.current && local && localVideo.current.srcObject !== local) {
        localVideo.current.srcObject = local
      }
      if (remoteVideo.current && remote && remoteVideo.current.srcObject !== remote) {
        remoteVideo.current.srcObject = remote
      }
      setHasRemoteVideo(!!remote?.getVideoTracks().some((t) => t.readyState === 'live'))
    }
    attach()
    // Tracks arrive after the call connects, and again when somebody starts
    // sharing a screen - so this keeps looking rather than attaching once.
    const timer = setInterval(attach, 700)
    return () => clearInterval(timer)
  }, [call, store])

  if (!call) return null

  const where = buffers.find((b) => b.id === call.bufferId)?.name ?? ''
  const phase =
    call.phase === 'ringing' ? 'Ringing…' : call.phase === 'connecting' ? 'Connecting…' : 'Connected'

  return (
    <div className="call-stage">
      <div className="call-stage-video">
        {/* Muted, because this is our own microphone coming back: playing it
            would be the oldest mistake in video calling. */}
        <video ref={remoteVideo} className={classes('call-remote', !hasRemoteVideo && 'audio-only')} autoPlay playsInline />
        {!hasRemoteVideo && (
          <div className="call-stage-placeholder muted">
            <Icon name="call" size={28} />
            <span>{phase}</span>
          </div>
        )}
        <video ref={localVideo} className="call-local" autoPlay playsInline muted />
      </div>

      <div className="call-stage-controls">
        {/* Which conversation this call is in, because the stage no longer
            sits under it: a call outlives looking at something else. */}
        <span className="small muted ellipsis">
          {phase}
          {where ? ` · ${bufferDisplayName(where)}` : ''}
        </span>
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
        <IconButton name="call_end" title="Hang up" className="calling" onClick={() => store.hangUpMatrixCall()} />
      </div>
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
