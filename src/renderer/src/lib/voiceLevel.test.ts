import { describe, expect, it } from 'vitest'
import { levelFill } from './voiceLevel'

describe('the microphone level bar', () => {
  it('is empty in a quiet room and full when loud', () => {
    expect(levelFill(0)).toBe(0)
    expect(levelFill(0.008)).toBe(0)
    expect(levelFill(0.5)).toBe(1)
  })

  it('moves visibly for ordinary speech, which a linear scale would not', () => {
    // Measured speech peaks of 0.02-0.05 against full scale 1.0.
    expect(levelFill(0.02)).toBeGreaterThan(0.2)
    expect(levelFill(0.05)).toBeGreaterThan(0.45)
    expect(levelFill(0.05)).toBeLessThan(0.7)
  })

  it('only ever rises with the level', () => {
    let last = -1
    for (let p = 0; p <= 0.2; p += 0.005) {
      const f = levelFill(p)
      expect(f).toBeGreaterThanOrEqual(last)
      last = f
    }
  })

  it('stays inside the bar for nonsense', () => {
    expect(levelFill(-1)).toBe(0)
    expect(levelFill(10)).toBe(1)
  })
})
