import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { classes } from '../lib/util'
import { useStore } from '../state/hooks'

/**
 * A video with the same controls on every service, drawn over the picture: play, a seek bar, the volume (which opens
 * out to a slider when the pointer is on it), the time (a click shows what is left instead of what has passed), the
 * speed, and full screen - which is the player's own, not a viewer's. Down the right at the top: save it, and edit the
 * message it is in when that message is the person's own.
 *
 * Over a real `<video>` element, so the rest of the window still sees a video: the "fetch it again" recovery for a
 * cached file that has gone listens for that element failing.
 */
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

/** The volume one video was left at is the volume of the next. */
let lastVolume = 1
let lastMuted = false

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

export function VideoPlayer({
  src,
  className,
  style,
  loop,
  autoPlay,
  filename,
  saveFrom,
  onEdit,
  onError
}: {
  src: string
  className?: string
  style?: React.CSSProperties
  loop: boolean
  autoPlay: boolean
  filename?: string
  /** What to save: the original where there is one, else what is playing. */
  saveFrom?: string
  /** Present when the message the video is in can be edited by this person. */
  onEdit?: () => void
  onError: () => void
}): JSX.Element {
  const store = useStore()
  const wrap = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [length, setLength] = useState(0)
  const [remaining, setRemaining] = useState(false)
  const [volume, setVolume] = useState(lastVolume)
  const [muted, setMuted] = useState(lastMuted)
  const [rate, setRate] = useState(1)
  const [speeds, setSpeeds] = useState(false)
  const [full, setFull] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const v = video.current
    if (!v) return
    v.volume = lastVolume
    v.muted = lastMuted
  }, [])

  useEffect(() => {
    const onFull = (): void => setFull(document.fullscreenElement === wrap.current)
    document.addEventListener('fullscreenchange', onFull)
    return () => document.removeEventListener('fullscreenchange', onFull)
  }, [])

  // The speed list closes on a click anywhere else.
  useEffect(() => {
    if (!speeds) return
    const away = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement | null)?.closest('.vp-speed')) setSpeeds(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [speeds])

  const toggle = (): void => {
    const v = video.current
    if (!v) return
    if (v.paused) void v.play().catch(() => {})
    else v.pause()
  }

  const seek = (to: number): void => {
    const v = video.current
    if (v) v.currentTime = to
  }

  const setLevel = (level: number): void => {
    const v = video.current
    if (!v) return
    v.volume = level
    v.muted = level === 0
    lastVolume = level || lastVolume
    lastMuted = level === 0
  }

  const mute = (): void => {
    const v = video.current
    if (!v) return
    v.muted = !v.muted
    lastMuted = v.muted
    if (!v.muted && v.volume === 0) v.volume = 1
  }

  const fullScreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void wrap.current?.requestFullscreen?.().catch(() => {})
  }

  const save = (): void => {
    if (saving) return
    setSaving(true)
    void window.moho
      .downloadMedia(saveFrom || src, filename)
      .then((res) => store.toast(res.error ? 'error' : 'info', res.error ? `Couldn't save: ${res.error}` : `Saved to ${res.path}`))
      .catch((e: Error) => store.toast('error', `Couldn't save: ${e.message}`))
      .finally(() => setSaving(false))
  }

  const shownVolume = muted ? 0 : volume
  const progress = length > 0 ? (time / length) * 100 : 0

  return (
    <div ref={wrap} className={classes('vp', playing && 'playing', full && 'full')} style={style}>
      <video
        ref={video}
        className={classes('vp-video', className)}
        src={src}
        loop={loop}
        autoPlay={autoPlay}
        // Enough to draw the first frame and know how long it is, without pulling megabytes for every video in a
        // scrolled-past backlog.
        preload="metadata"
        playsInline
        onClick={toggle}
        onDoubleClick={fullScreen}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => setLength(e.currentTarget.duration)}
        onLoadedMetadata={(e) => setLength(e.currentTarget.duration)}
        onVolumeChange={(e) => {
          setVolume(e.currentTarget.volume)
          setMuted(e.currentTarget.muted)
        }}
        onRateChange={(e) => setRate(e.currentTarget.playbackRate)}
        onError={onError}
      />

      <div className="vp-top">
        {onEdit && (
          <button type="button" className="vp-button" title="Edit message" onClick={onEdit}>
            <Icon name="edit" size={18} />
          </button>
        )}
        <button type="button" className="vp-button" title="Save to your downloads folder" disabled={saving} onClick={save}>
          <Icon name={saving ? 'hourglass_empty' : 'download'} size={18} />
        </button>
      </div>

      <div className="vp-bar">
        <input
          className="vp-seek"
          type="range"
          min={0}
          max={length || 0}
          step="any"
          value={Math.min(time, length || 0)}
          style={{ ['--vp-progress' as string]: `${progress}%` }}
          aria-label="Seek"
          onChange={(e) => seek(Number(e.target.value))}
        />
        <div className="vp-controls">
          <button type="button" className="vp-button" title={playing ? 'Pause' : 'Play'} onClick={toggle}>
            <Icon name={playing ? 'pause' : 'play_arrow'} size={22} fill />
          </button>
          <div className="vp-volume">
            <button type="button" className="vp-button" title={muted ? 'Unmute' : 'Mute'} onClick={mute}>
              <Icon name={shownVolume === 0 ? 'volume_off' : shownVolume < 0.5 ? 'volume_down' : 'volume_up'} size={20} fill />
            </button>
            <input
              className="vp-level"
              type="range"
              min={0}
              max={1}
              step="0.01"
              value={shownVolume}
              style={{ ['--vp-progress' as string]: `${shownVolume * 100}%` }}
              aria-label="Volume"
              onChange={(e) => setLevel(Number(e.target.value))}
            />
          </div>
          <button
            type="button"
            className="vp-time"
            title={remaining ? 'Showing the time left; click for the time passed' : 'Showing the time passed; click for the time left'}
            onClick={() => setRemaining((r) => !r)}
          >
            {remaining ? `-${clock(Math.max(0, length - time))}` : clock(time)}
          </button>
          <span className="vp-fill" />
          <div className="vp-speed">
            <button type="button" className="vp-button" title="Playback speed" aria-haspopup="menu" aria-expanded={speeds} onClick={() => setSpeeds((o) => !o)}>
              <Icon name="speed" size={20} />
              {rate !== 1 && <span className="vp-rate">{rate}×</span>}
            </button>
            {speeds && (
              <div className="vp-speeds" role="menu">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="menuitemradio"
                    aria-checked={rate === s}
                    className={classes('vp-speed-option', rate === s && 'on')}
                    onClick={() => {
                      if (video.current) video.current.playbackRate = s
                      setSpeeds(false)
                    }}
                  >
                    {s === 1 ? 'Normal' : `${s}×`}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="vp-button" title={full ? 'Exit full screen' : 'Full screen'} onClick={fullScreen}>
            <Icon name={full ? 'fullscreen_exit' : 'fullscreen'} size={20} />
          </button>
        </div>
      </div>
    </div>
  )
}
