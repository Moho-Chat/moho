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

  // This side's picture while it is on - the screen when shared, else the camera: shown small, and read into frames for
  // main.
  const sharing = !!live?.sharing
  const cameraOn = !!live && (!live.videoMuted || sharing)
  useEffect(() => {
    if (!cameraOn) return
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
        const video = mine.current
        if (video) {
          video.srcObject = got
          void video.play().catch(() => {})
        }
        // A share stopped from the desktop's own control ends the share here too.
        got.getVideoTracks()[0]?.addEventListener('ended', () => sharing && store.shareSignalCallScreen(false))
        timer = setInterval(() => {
          const v = mine.current
          if (!v || !context || v.readyState < 2) return
          context.drawImage(v, 0, 0, width, height)
          const pixels = context.getImageData(0, 0, width, height)
          window.moho.sendSignalCallFrame(width, height, new Uint8Array(pixels.data.buffer))
        }, SEND_EVERY_MS)
      })
      .catch((e: Error) => {
        if (sharing) {
          store.shareSignalCallScreen(false)
          return
        }
        store.toast('error', `The camera could not be used: ${e.message}`)
        store.muteSignalCall({ video: true })
      })
    return () => {
      stopped = true
      if (timer) clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [cameraOn, sharing, store])

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
