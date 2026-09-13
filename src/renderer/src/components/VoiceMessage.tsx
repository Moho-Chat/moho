import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import { resolveMediaUrl } from '../lib/util'
import type { Attachment } from '../../../shared/wire'

/**
 * Somebody speaking, drawn as the thing it is.
 *
 * A voice message used to arrive here as an audio file with a generic player
 * and a name - `voice-message.ogg` - and nothing to say how long it was or
 * that anybody had spoken it. That is ordinary traffic in a Discord DM, and
 * the two things a person wants before deciding to listen are exactly the two
 * the sender's client already provided and this dropped: the length, and the
 * shape of the sound.
 *
 * The waveform is the sender's own, not one computed here. Discord ships up to
 * 256 bytes of amplitude with the message, so the picture can be drawn before a
 * single byte of audio is fetched - which is the point, since fetching it is
 * the thing being decided about.
 */
export function VoiceMessage({ attachment }: { attachment: Attachment }): JSX.Element {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState(0)
  const [failed, setFailed] = useState(false)
  /**
   * Faster playback, because a voice message is often somebody taking thirty
   * seconds to say one sentence. Cycled through a short list rather than being
   * a slider: the useful answers are "normal", "a bit quicker" and "get on
   * with it", and a slider offers a hundred that are not.
   */
  const [speed, setSpeed] = useState(1)
  const [muted, setMuted] = useState(false)
  /**
   * Whether anybody has actually asked to hear this yet.
   *
   * The element reports an error for a source it cannot load, and a Discord
   * attachment URL expires - so without this, a message whose link had aged
   * out replaced itself with "could not be played" on sight, throwing away the
   * length and the waveform, which are known here without fetching anything
   * and are most of what the control is for. An error nobody provoked is not
   * yet a failure to report.
   */
  const asked = useRef(false)

  const src = resolveMediaUrl(attachment.path || attachment.url || '')
  // The sender's figure where there is one. An audio element only knows the
  // length once it has enough of the file to say, which is after the fetch
  // this display exists to let somebody avoid.
  const total = attachment.durationSecs ?? audio.current?.duration ?? 0
  const played = total > 0 ? Math.min(1, at / total) : 0
  // As many bars as the recording has time for, rather than a fixed number
  // stretched across whatever it is. Four a second reads as speech; a
  // two-second message drawn with forty-four bars looks like a long one, and
  // the width of the control stops saying anything about the length.
  const bars = useBars(attachment.waveform, Math.max(MIN_BARS, Math.min(BARS, Math.round(total * 4))))

  useEffect(() => {
    const el = audio.current
    if (!el) return
    const tick = (): void => setAt(el.currentTime)
    const ended = (): void => {
      setPlaying(false)
      setAt(0)
    }
    el.addEventListener('timeupdate', tick)
    el.addEventListener('ended', ended)
    return () => {
      el.removeEventListener('timeupdate', tick)
      el.removeEventListener('ended', ended)
    }
  }, [src])

  useEffect(() => {
    const el = audio.current
    if (!el) return
    el.playbackRate = speed
    el.muted = muted
  }, [speed, muted])

  const toggle = (): void => {
    const el = audio.current
    if (!el) return
    if (el.paused) {
      asked.current = true
      void el.play().catch(() => setFailed(true))
      setPlaying(true)
    } else {
      el.pause()
      setPlaying(false)
    }
  }

  /** Scrubbing, by clicking the picture of the sound at the point wanted. */
  const seek = (e: React.MouseEvent<HTMLDivElement>): void => {
    const el = audio.current
    if (!el || !total) return
    const box = e.currentTarget.getBoundingClientRect()
    const fraction = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
    el.currentTime = fraction * total
    setAt(el.currentTime)
  }

  if (failed) {
    return (
      <div className="voice-message failed small muted">
        <Icon name="mic_off" size={18} />
        <span>This voice message could not be played.</span>
      </div>
    )
  }

  return (
    <div className="voice-message">
      <button
        type="button"
        className="voice-play"
        disabled={!src}
        onClick={toggle}
        title={playing ? 'Pause' : 'Play'}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        <Icon name={playing ? 'pause' : 'play_arrow'} size={20} />
      </button>

      <div className="voice-wave" onClick={seek} role="presentation">
        {bars.map((height, i) => (
          <span
            key={i}
            // Strictly past, so a message nobody has started shows no
            // progress at all - at zero the first bar was coming up
            // coloured, which reads as already part-listened-to.
            className={(i + 1) / bars.length <= played ? 'voice-bar played' : 'voice-bar'}
            // A floor with some height to it. Silence has to stay a bar
            // rather than become a dot: a pause is part of what somebody
            // said, it is part of the length being scrubbed through, and a
            // row of specks reads as a control that failed to load.
            style={{ height: `${Math.max(22, height * 100)}%` }}
          />
        ))}
      </div>

      <span className="voice-time small muted tabular">
        {clock(playing || at > 0 ? at : total)}
      </span>

      <span className="voice-extra">
        <button
          type="button"
          className={speed === 1 ? 'voice-speed' : 'voice-speed changed'}
          title="Playback speed"
          onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
        >
          {speed}x
        </button>
        <button
          type="button"
          className="voice-mute"
          title={muted ? 'Unmute' : 'Mute'}
          aria-label={muted ? 'Unmute' : 'Mute'}
          onClick={() => setMuted(!muted)}
        >
          <Icon name={muted ? 'volume_off' : 'volume_up'} size={18} />
        </button>
      </span>

      <audio
        ref={audio}
        src={src}
        preload="none"
        onError={() => {
          if (asked.current) setFailed(true)
        }}
      />
    </div>
  )
}

/**
 * How many bars to draw.
 *
 * Discord sends up to 256 samples and its own client draws far fewer; at the
 * width this sits in, one bar per sample is a solid block. The samples are
 * averaged down rather than picked from, so a short spike does not vanish
 * because the sampling happened to step over it.
 */
const BARS = 40

/**
 * The fewest bars to draw.
 *
 * A one-second message still has to look like a waveform rather than like
 * three marks, and something has to be clickable to seek with.
 */
const MIN_BARS = 14

/** The speeds worth having, in the order the button walks through them. */
const SPEEDS = [1, 1.5, 2]

/** The sender's waveform, decoded and reduced to the bars actually drawn. */
function useBars(waveform: string | undefined, count: number): number[] {
  return useMemo(() => barsFrom(waveform, count), [waveform, count])
}

/**
 * Somebody else's base64, turned into the heights of the bars drawn.
 *
 * Exported for its own sake: this is the only arithmetic in the component and
 * the only part that can be wrong quietly - a waveform decoded badly still
 * draws, it just draws a lie about what was said.
 *
 * Averaged down rather than sampled, so a short loud moment does not vanish
 * because the step happened to land either side of it. Anything unreadable
 * gives a flat line: a voice message with no usable waveform is still a voice
 * message, and Discord does send them without one.
 */
export function barsFrom(waveform: string | undefined, bars = BARS): number[] {
  const flat = (): number[] => new Array(bars).fill(0.25)
  if (!waveform) return flat()
  try {
    const raw = atob(waveform)
    if (raw.length === 0) return flat()
    const samples = Array.from(raw, (c) => c.charCodeAt(0) / 255)
    const step = samples.length / bars
    return Array.from({ length: bars }, (_, i) => {
      const from = Math.floor(i * step)
      const to = Math.max(from + 1, Math.floor((i + 1) * step))
      const slice = samples.slice(from, to)
      return slice.reduce((sum, v) => sum + v, 0) / (slice.length || 1)
    })
  } catch {
    return flat()
  }
}

/** Seconds as a person reads them. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
