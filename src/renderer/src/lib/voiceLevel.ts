/**
 * How full the level bar is for a microphone peak (0-1).
 *
 * On a square-root scale between a quiet room and loud speech, not a linear
 * scale of full scale. Measured on this hardware a quiet room sits around
 * 0.008 and ordinary speech peaks between 0.02 and 0.05 - so anything scaled
 * against 1.0 stays dark while somebody is talking, which is exactly the
 * failure a meter exists to rule out. The root spreads that quiet end out the
 * way hearing does.
 */
export function levelFill(peak: number): number {
  const floor = Math.sqrt(0.008)
  const top = Math.sqrt(0.12)
  return Math.min(1, Math.max(0, (Math.sqrt(Math.max(0, peak)) - floor) / (top - floor)))
}
