/**
 * Who is talking, measured from the audio itself.
 *
 * Discord's voice call view is told this by the daemon, which holds that
 * connection and can hear it. A call held in this window has no such helper:
 * the audio is here, so the measuring is here too, which is the same division
 * the rest of the call follows.
 *
 * Root-mean-square rather than peak, sampled a few times a second: a peak
 * lights up on a chair creaking, and an indicator that flickers is worse than
 * none because it teaches people to ignore it.
 */

/** Below this is a room with somebody in it, not somebody talking. */
export const SPEAKING_FLOOR = 0.015

/** How often to look. Fast enough to land on the right person mid-sentence. */
const SAMPLE_MS = 120

/**
 * How long a voice keeps the light on after it stops.
 *
 * Speech is full of gaps - between words, between breaths - and an indicator
 * that follows them exactly strobes. This is the shortest hold that reads as
 * one person talking rather than as a flashing box.
 */
const HOLD_MS = 400

interface Watched {
  stream: MediaStream
  analyser: AnalyserNode
  data: Uint8Array<ArrayBuffer>
  /** When this voice was last above the floor. */
  lastHeard: number
  peak: number
}

export class Levels {
  private context: AudioContext | null = null
  private watched = new Map<string, Watched>()
  private timer: ReturnType<typeof setInterval> | null = null

  /** Starts measuring one person's audio, or leaves it alone if already on. */
  watch(id: string, stream: MediaStream | null): void {
    if (!stream || stream.getAudioTracks().length === 0) {
      this.watched.delete(id)
      return
    }
    const existing = this.watched.get(id)
    if (existing?.stream === stream) return

    try {
      // Created on first use rather than at startup: a window that never makes
      // a call should not hold an audio device open.
      this.context = this.context ?? new AudioContext()
      const analyser = this.context.createAnalyser()
      analyser.fftSize = 512
      this.context.createMediaStreamSource(stream).connect(analyser)
      this.watched.set(id, {
        stream,
        analyser,
        data: new Uint8Array(new ArrayBuffer(analyser.fftSize)),
        lastHeard: 0,
        peak: 0
      })
      this.start()
    } catch {
      // A stream with nothing to measure is not worth an error: the call
      // still works, it just has no light beside the name.
    }
  }

  /** Whether this person is talking now. */
  speaking(id: string): boolean {
    const watched = this.watched.get(id)
    if (!watched) return false
    return Date.now() - watched.lastHeard < HOLD_MS
  }

  /** Stops measuring everybody and lets the audio device go. */
  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.watched.clear()
    void this.context?.close()
    this.context = null
  }

  private start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      const now = Date.now()
      for (const watched of this.watched.values()) {
        watched.analyser.getByteTimeDomainData(watched.data)
        let sum = 0
        for (const sample of watched.data) {
          // The bytes are centred on 128; the distance from there is the
          // signal.
          const value = (sample - 128) / 128
          sum += value * value
        }
        watched.peak = Math.sqrt(sum / watched.data.length)
        if (watched.peak > SPEAKING_FLOOR) watched.lastHeard = now
      }
    }, SAMPLE_MS)
  }
}
