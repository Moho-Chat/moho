import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { useStore } from '../state/hooks'

/** What the daemon says about a recording in progress. */
interface Progress {
  recording: boolean
  bufferId?: string
  seconds?: number
  level?: number
}

/**
 * Saying something instead of typing it.
 *
 * The microphone, the encoder and the upload all live in the daemon - it
 * already captures audio for calls and links the same Opus library - so what
 * is here is the part a person interacts with: press to start, watch a clock
 * and a level meter that proves the microphone is actually hearing something,
 * then send or throw it away.
 *
 * The meter matters more than it looks. A voice message recorded from a muted
 * or misrouted microphone is silence, and there is nothing about sending one
 * that would say so - the sender finds out when somebody tells them. A bar
 * that moves while they talk is the whole of the check.
 */
export function VoiceRecorder({ bufferId }: { bufferId: string }): JSX.Element {
  const store = useStore()
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  /** Polled rather than pushed: it is only wanted while somebody watches it. */
  useEffect(() => {
    if (!recording) return
    timer.current = setInterval(() => {
      void window.moho
        .rpc<Progress>('voiceMessageProgress', {})
        .then((p) => {
          if (!p.recording) {
            setRecording(false)
            return
          }
          setSeconds(p.seconds ?? 0)
          setLevel(p.level ?? 0)
        })
        .catch(() => {})
    }, 200)
    return () => {
      if (timer.current) clearInterval(timer.current)
      timer.current = null
    }
  }, [recording])

  // A recording belongs to the conversation it was started in. Moving to
  // another one abandons it rather than quietly sending it somewhere else.
  useEffect(() => {
    return () => {
      if (recording) void window.moho.rpc('cancelVoiceMessage', {}).catch(() => {})
    }
  }, [bufferId])

  const start = (): void => {
    setBusy(true)
    void window.moho
      .rpc('startVoiceMessage', { bufferId })
      .then(() => {
        setSeconds(0)
        setLevel(0)
        setRecording(true)
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  const send = (): void => {
    setBusy(true)
    setRecording(false)
    void window.moho
      .rpc('sendVoiceMessage', {})
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  const cancel = (): void => {
    setRecording(false)
    void window.moho.rpc('cancelVoiceMessage', {}).catch(() => {})
  }

  if (!recording) {
    return (
      <button
        type="button"
        className="icon-button"
        title="Record a voice message"
        disabled={busy}
        onClick={start}
      >
        <Icon name="mic" size={18} />
      </button>
    )
  }

  return (
    <div className="voice-recorder">
      <button type="button" className="icon-button" title="Throw it away" onClick={cancel}>
        <Icon name="delete" size={18} />
      </button>
      <span className="voice-recording-dot" />
      <span className="small tabular">{clock(seconds)}</span>
      {/* Not a decoration: this is how somebody knows the microphone is the
          one they think it is, before they send silence to a friend. */}
      <span className="voice-meter" title="What the microphone is hearing">
        <span className="voice-meter-fill" style={{ width: `${Math.min(100, level * 140)}%` }} />
      </span>
      <button
        type="button"
        className="icon-button"
        title="Send it"
        disabled={busy}
        onClick={send}
      >
        <Icon name="send" size={18} />
      </button>
    </div>
  )
}

/** Seconds as a person reads them. */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
