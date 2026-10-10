/**
 * Whether the person has stepped away, which is all this knows.
 *
 * Discord's own client and every IRC client that sets itself away work from the
 * same one fact - how long since anything was touched - and nothing else: not
 * what is on screen, not what was typed, not which program is in front. This is
 * kept to that, and is deliberately small: a clock, two sources of "how long",
 * and a threshold.
 *
 * The two sources are the system's own idle time, where the platform will say
 * (Windows, macOS, X11), and moho's own windows being used, which every
 * platform can say. Some Wayland desktops give Chromium no idle time at all and
 * report zero for ever, which looks exactly like somebody who never stops
 * typing; so the system's figure is only believed once it has been seen to be
 * anything but zero, and until then - and where it never is - moho goes by its
 * own windows.
 */

export interface IdleOptions {
  now: () => number
  /** Seconds since the last keyboard or mouse input anywhere; 0 where the platform cannot say. */
  systemIdleSeconds: () => number
  enabled: () => boolean
  thresholdMs: () => number
  /** Said when the answer changes, and only then. */
  onChange: (idle: boolean) => void
}

export class IdleWatcher {
  private lastActivity: number
  private systemKnown = false
  private away = false
  /** The screen is locked or the machine asleep: away at once, whatever the clock says. */
  private locked = false
  private forced: boolean | null = null

  constructor(private o: IdleOptions) {
    this.lastActivity = o.now()
  }

  isIdle(): boolean {
    return this.away
  }

  /** When something was last used in a moho window, for the harness to see that it was heard. */
  lastActivityAt(): number {
    return this.lastActivity
  }

  /** Something was used in a moho window - including coming back to one. */
  activity(): void {
    this.lastActivity = this.o.now()
    this.locked = false
    this.evaluate()
  }

  lock(): void {
    this.locked = true
    this.evaluate()
  }

  unlock(): void {
    this.locked = false
    this.lastActivity = this.o.now()
    this.evaluate()
  }

  /** For the harness: an answer that the clock does not get to change. */
  forceForTesting(idle: boolean | null): void {
    this.forced = idle
    this.evaluate()
  }

  /** Asks the clocks, and says so if the answer is different. Run on a timer, and when a setting moves. */
  evaluate(): void {
    this.set(this.decide())
  }

  private decide(): boolean {
    if (this.forced !== null) return this.forced
    if (!this.o.enabled()) return false
    if (this.locked) return true
    const system = this.o.systemIdleSeconds()
    if (system > 0) this.systemKnown = true
    const own = this.o.now() - this.lastActivity
    // Whichever is shorter: a keystroke in another program counts as being
    // here once the system can say so, and one in moho counts either way.
    const idleFor = this.systemKnown ? Math.min(own, system * 1000) : own
    return idleFor >= this.o.thresholdMs()
  }

  private set(idle: boolean): void {
    if (idle === this.away) return
    this.away = idle
    this.o.onChange(idle)
  }
}
