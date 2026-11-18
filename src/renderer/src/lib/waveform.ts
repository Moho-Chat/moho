/** Levels (0 to 1) averaged down to the bars drawn, never quite flat so a quiet stretch is still a bar. */
export function reduceLevels(levels: number[], bars: number): number[] {
  if (levels.length === 0) return new Array(bars).fill(0.25)
  const step = levels.length / bars
  return Array.from({ length: bars }, (_, i) => {
    const slice = levels.slice(Math.floor(i * step), Math.max(Math.floor(i * step) + 1, Math.floor((i + 1) * step)))
    return Math.max(0.08, slice.reduce((sum, v) => sum + v, 0) / (slice.length || 1))
  })
}
