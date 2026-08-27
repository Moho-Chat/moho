/**
 * The sound an incoming call makes.
 *
 * Synthesised rather than a bundled audio file. Two reasons: a ringtone is a
 * handful of sine waves and shipping a megabyte of encoded audio to reproduce
 * them is silly, and the recognisable ring of any given chat client is that
 * client's own - approximating the shape of one is fine, copying the file is
 * not.
 *
 * The pattern is the familiar one: a pair of notes, a beat apart, then silence
 * for the rest of the period. Each note is a triangle wave through a gain
 * envelope, because a bare oscillator switched on and off clicks audibly at
 * both ends.
 */

/** A4 and the fifth above it - a ring, rather than an alarm. */
const NOTES = [440, 587.33]
const NOTE_SECONDS = 0.42
const GAP_SECONDS = 0.14
/** How often the pair repeats. The silence between is most of it. */
const PERIOD_MS = 2600

export class Ringtone {
  private context: AudioContext | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  get playing(): boolean {
    return this.timer !== null
  }

  /** Starts ringing, or does nothing if it already is. */
  start(): void {
    if (this.timer) return
    // Constructed on the first ring rather than at module load: a context made
    // before any user gesture starts suspended, and browsers count that
    // against the page.
    if (!this.context) {
      try {
        this.context = new AudioContext()
      } catch {
        // No audio output at all. A silent ring is still a visible one.
        return
      }
    }
    void this.context.resume()
    this.ring()
    this.timer = setInterval(() => this.ring(), PERIOD_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    // The context is kept, not closed: a call declined and another arriving a
    // moment later should not pay to build one again.
    void this.context?.suspend()
  }

  private ring(): void {
    const ctx = this.context
    if (!ctx) return
    NOTES.forEach((frequency, i) => {
      const at = ctx.currentTime + i * (NOTE_SECONDS + GAP_SECONDS)
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = frequency

      // Ramped at both ends. A gain that steps from 0 to full is a click, and
      // a ringtone that clicks twelve times a minute is worse than no sound.
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(0.18, at + 0.02)
      gain.gain.setValueAtTime(0.18, at + NOTE_SECONDS - 0.06)
      gain.gain.linearRampToValueAtTime(0, at + NOTE_SECONDS)

      osc.connect(gain).connect(ctx.destination)
      osc.start(at)
      osc.stop(at + NOTE_SECONDS)
    })
  }
}
