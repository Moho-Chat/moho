import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { bufferDisplayName } from '../lib/util'

/** How big this side's picture is sent: what a 1:1 call needs, and light enough to go frame by frame to main. */
const SEND_WIDTH = 640
const SEND_HEIGHT = 360
const SEND_EVERY_MS = 66
/** A shared screen is sent larger: its words have to be read. */
const SHARE_WIDTH = 1280
const SHARE_HEIGHT = 720

/**
 * A Signal call that is on: who, how it is going, the other side's picture, and the buttons. The call is RingRTC's, in
 * main (see main/signal-calls.ts); its sound goes straight to the speakers from there. Pictures cross as frames: theirs
 * drawn on a canvas as they come, this side's camera read here and sent on.
 */
export function SignalCallPanel(): JSX.Element | null {
  const store = useStore()
  const call = useChat((s) => s.signalCall)
  const buffers = useChat((s) => s.buffers)
  const theirs = useRef<HTMLCanvasElement>(null)
  const mine = useRef<HTMLVideoElement>(null)
  const [since, setSince] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())

  const live = call && call.state !== 'ringing' ? call : null
  const connected = live?.state === 'connected'

  // A clock from when it connected.
  useEffect(() => {
    if (!connected) {
      setSince(null)
      return
    }
    setSince((s) => s ?? Date.now())
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [connected])

  // Their picture, frame by frame.
  useEffect(() => {
    if (!live) return
    return window.moho.onSignalCallFrame((width, height, rgba) => {
      const canvas = theirs.current
      if (!canvas) return
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      const context = canvas.getContext('2d')
      if (!context) return
      const image = context.createImageData(width, height)
      image.data.set(rgba.subarray(0, width * height * 4))
      context.putImageData(image, 0, 0)
    })
  }, [live])

  const sharing = !!live?.sharing
  const cameraOn = !!live && (!live.videoMuted || sharing)
  useOutgoingPicture(mine, cameraOn, sharing, () => store.shareSignalCallScreen(false), () => store.muteSignalCall({ video: true }))

  if (!live) return null
  const buffer = buffers.find((b) => b.id === live.bufferId)
  const name = buffer ? bufferDisplayName(buffer.name) : 'Signal call'
  const seconds = since ? Math.max(0, Math.floor((now - since) / 1000)) : 0
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const status =
    live.state === 'connected' ? clock : live.state === 'reconnecting' ? 'Reconnecting…' : live.incoming ? 'Connecting…' : 'Ringing…'

  return (
    <div className="signal-call" role="region" aria-label={`Call with ${name}`}>
      <div className="signal-call-stage">
        <canvas ref={theirs} className={live.remoteVideo ? 'signal-call-theirs' : 'signal-call-theirs hidden'} />
        {!live.remoteVideo && (
          <div className="signal-call-placeholder">
            <Icon name="person" size={48} />
          </div>
        )}
        {cameraOn && <video ref={mine} className={sharing ? 'signal-call-mine sharing' : 'signal-call-mine'} muted playsInline />}
      </div>
      <div className="signal-call-bar">
        <div className="signal-call-who">
          <span className="ellipsis">{name}</span>
          <span className="small muted">
            {status}
            {!live.remoteAudio && ' · they are muted'}
          </span>
        </div>
        <button
          type="button"
          className={live.audioMuted ? 'call-toggle on' : 'call-toggle'}
          title={live.audioMuted ? 'Unmute' : 'Mute'}
          aria-pressed={live.audioMuted}
          onClick={() => store.muteSignalCall({ audio: !live.audioMuted })}
        >
          <Icon name={live.audioMuted ? 'mic_off' : 'mic'} size={20} />
        </button>
        <button
          type="button"
          className={live.videoMuted ? 'call-toggle' : 'call-toggle on'}
          title={live.videoMuted ? 'Turn the camera on' : 'Turn the camera off'}
          aria-pressed={!live.videoMuted}
          onClick={() => store.muteSignalCall({ video: !live.videoMuted })}
        >
          <Icon name={live.videoMuted ? 'videocam_off' : 'videocam'} size={20} />
        </button>
        <button
          type="button"
          className={sharing ? 'call-toggle on' : 'call-toggle'}
          title={sharing ? 'Stop sharing your screen' : 'Share your screen'}
          aria-pressed={sharing}
          onClick={() => store.shareSignalCallScreen(!sharing)}
        >
          <Icon name={sharing ? 'stop_screen_share' : 'screen_share'} size={20} />
        </button>
        <button type="button" className="call-decline" title="Hang up" onClick={() => store.hangUpSignalCall()}>
          <Icon name="call_end" size={20} />
        </button>
      </div>
    </div>
  )
}

/**
 * This side's picture while it is on - the screen when shared, else the camera: shown in `preview`, and read into
 * frames for main (which hands them to whichever call is on).
 */
export function useOutgoingPicture(
  preview: React.RefObject<HTMLVideoElement>,
  on: boolean,
  sharing: boolean,
  stopSharing: () => void,
  cameraOff: () => void
): void {
  const store = useStore()
  useEffect(() => {
    if (!on) return
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setInterval> | null = null
    let stopped = false
    const width = sharing ? SHARE_WIDTH : SEND_WIDTH
    const height = sharing ? SHARE_HEIGHT : SEND_HEIGHT
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const source = sharing
      ? navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      : navigator.mediaDevices.getUserMedia({ video: { width: SEND_WIDTH, height: SEND_HEIGHT }, audio: false })
    void source
      .then((got) => {
        if (stopped) {
          got.getTracks().forEach((t) => t.stop())
          return
        }
        stream = got
        const video = preview.current
        if (video) {
          video.srcObject = got
          void video.play().catch(() => {})
        }
        // A share stopped from the desktop's own control ends the share here too.
        got.getVideoTracks()[0]?.addEventListener('ended', () => sharing && stopSharing())
        timer = setInterval(() => {
          const v = preview.current
          if (!v || !context || v.readyState < 2) return
          context.drawImage(v, 0, 0, width, height)
          const pixels = context.getImageData(0, 0, width, height)
          window.moho.sendSignalCallFrame(width, height, new Uint8Array(pixels.data.buffer))
        }, SEND_EVERY_MS)
      })
      .catch((e: Error) => {
        if (sharing) {
          stopSharing()
          return
        }
        store.toast('error', `The camera could not be used: ${e.message}`)
        cameraOff()
      })
    return () => {
      stopped = true
      if (timer) clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, sharing])
}

/**
 * A Signal group's call that is on: a tile for each other person (their picture as it comes, by demux id), and the
 * same buttons as a call with one person.
 */
export function SignalGroupCallPanel(): JSX.Element | null {
  const store = useStore()
  const call = useChat((s) => s.signalGroupCall)
  const buffers = useChat((s) => s.buffers)
  const mine = useRef<HTMLVideoElement>(null)
  const tiles = useRef(new Map<number, HTMLCanvasElement>())
  const [names, setNames] = useState<Record<string, string>>({})
  const reactions = useChat((s) => s.signalCallReactions)
  const [reacting, setReacting] = useState(false)

  useEffect(() => {
    if (!call) return
    return window.moho.onSignalCallFrame((width, height, rgba, demuxId) => {
      if (demuxId === undefined) return
      const canvas = tiles.current.get(demuxId)
      if (!canvas) return
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      const context = canvas.getContext('2d')
      if (!context) return
      const image = context.createImageData(width, height)
      image.data.set(rgba.subarray(0, width * height * 4))
      context.putImageData(image, 0, 0)
    })
  }, [call])

  // Who each participant is, by name, from the group's member list.
  const bufferId = call?.bufferId
  useEffect(() => {
    if (!bufferId) return
    void window.moho
      .rpc<{ members?: { userId: string; nick: string }[] }>('signalGroupInfo', { bufferId })
      .then((info) => setNames(Object.fromEntries((info.members ?? []).map((m) => [m.userId, m.nick]))))
      .catch(() => {})
  }, [bufferId])

  const sharing = !!call?.sharing
  const pictureOn = !!call && call.joinState !== 'ended' && (!call.videoMuted || sharing)
  useOutgoingPicture(mine, pictureOn, sharing, () => store.shareSignalGroupCallScreen(false), () => store.muteSignalGroupCall({ video: true }))

  if (!call) return null
  const buffer = buffers.find((b) => b.id === call.bufferId)
  const name = call.callLink ? call.callLink.name : buffer ? bufferDisplayName(buffer.name) : 'Group call'
  const status =
    call.joinState === 'pending'
      ? 'Waiting to be let in…'
      : call.joinState !== 'joined'
        ? 'Joining…'
        : call.participants.length === 0
          ? 'Nobody else is here yet'
          : `${call.participants.length + 1} in the call`

  return (
    <div className="signal-call signal-group-call" role="region" aria-label={`Call in ${name}`}>
      <div className="signal-group-tiles">
        {call.participants.map((p) => (
          <div key={p.demuxId} className="signal-group-tile">
            <canvas
              ref={(el) => {
                if (el) tiles.current.set(p.demuxId, el)
                else tiles.current.delete(p.demuxId)
              }}
              className={p.videoMuted ? 'signal-call-theirs hidden' : 'signal-call-theirs'}
            />
            {p.videoMuted && (
              <div className="signal-call-placeholder">
                <Icon name="person" size={32} />
              </div>
            )}
            <span className="signal-group-name small">
              {call.raisedHands.includes(p.demuxId) && <Icon name="back_hand" size={12} />}
              {names[p.userId] ?? 'Someone'}
              {p.audioMuted && <Icon name="mic_off" size={12} />}
            </span>
            {reactions.filter((r) => r.demuxId === p.demuxId).slice(-1).map((r) => (
              <span key={r.at} className="signal-group-reaction">
                {r.value}
              </span>
            ))}
          </div>
        ))}
        {pictureOn && (
          <div className="signal-group-tile">
            <video ref={mine} className={sharing ? 'signal-call-theirs' : 'signal-call-theirs mirrored'} muted playsInline />
            <span className="signal-group-name small">You</span>
          </div>
        )}
      </div>
      {call.pending.length > 0 && (
        <div className="signal-group-pending small">
          {call.pending.map((userId) => (
            <div key={userId} className="field-row">
              <span className="grow">{names[userId] ?? 'Somebody'} is asking to join</span>
              <button type="button" className="button subtle small" onClick={() => store.answerSignalJoinRequest(userId, true)}>
                Let in
              </button>
              <button type="button" className="button subtle small" onClick={() => store.answerSignalJoinRequest(userId, false)}>
                Turn away
              </button>
            </div>
          ))}
        </div>
      )}
      {reacting && (
        <div className="signal-group-reacts">
          {['👍', '❤️', '😂', '😮', '😢', '🎉'].map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                store.reactInSignalGroupCall(e)
                setReacting(false)
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
      <div className="signal-call-bar">
        <div className="signal-call-who">
          <span className="ellipsis">{name}</span>
          <span className="small muted">{status}</span>
        </div>
        <button
          type="button"
          className={call.ownDemuxId !== undefined && call.raisedHands.includes(call.ownDemuxId) ? 'call-toggle on' : 'call-toggle'}
          title="Raise your hand"
          onClick={() => store.raiseSignalHand(!(call.ownDemuxId !== undefined && call.raisedHands.includes(call.ownDemuxId)))}
        >
          <Icon name="back_hand" size={20} />
        </button>
        <button type="button" className={reacting ? 'call-toggle on' : 'call-toggle'} title="React" onClick={() => setReacting((r) => !r)}>
          <Icon name="add_reaction" size={20} />
        </button>
        <button
          type="button"
          className={call.audioMuted ? 'call-toggle on' : 'call-toggle'}
          title={call.audioMuted ? 'Unmute' : 'Mute'}
          aria-pressed={call.audioMuted}
          onClick={() => store.muteSignalGroupCall({ audio: !call.audioMuted })}
        >
          <Icon name={call.audioMuted ? 'mic_off' : 'mic'} size={20} />
        </button>
        <button
          type="button"
          className={call.videoMuted ? 'call-toggle' : 'call-toggle on'}
          title={call.videoMuted ? 'Turn the camera on' : 'Turn the camera off'}
          aria-pressed={!call.videoMuted}
          onClick={() => store.muteSignalGroupCall({ video: !call.videoMuted })}
        >
          <Icon name={call.videoMuted ? 'videocam_off' : 'videocam'} size={20} />
        </button>
        <button
          type="button"
          className={sharing ? 'call-toggle on' : 'call-toggle'}
          title={sharing ? 'Stop sharing your screen' : 'Share your screen'}
          aria-pressed={sharing}
          onClick={() => store.shareSignalGroupCallScreen(!sharing)}
        >
          <Icon name={sharing ? 'stop_screen_share' : 'screen_share'} size={20} />
        </button>
        <button type="button" className="call-decline" title="Leave the call" onClick={() => store.leaveSignalGroupCall()}>
          <Icon name="call_end" size={20} />
        </button>
      </div>
    </div>
  )
}
