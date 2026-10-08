import { describe, expect, it } from 'vitest'
import { actualSize, clampView, FIT, MAX_SCALE, wheelFactor, zoomAt } from './zoompan'

const stage = { w: 1000, h: 600 }
const fitted = { w: 800, h: 500 }

describe('zoomAt', () => {
  it('keeps the point under the pointer where it was', () => {
    const p = { x: 120, y: -40 }
    const v = zoomAt(FIT, 2, p, fitted, stage)
    // The point of the picture that was under p, before and after.
    expect((p.x - FIT.x) / FIT.scale).toBeCloseTo((p.x - v.x) / v.scale)
    expect((p.y - FIT.y) / FIT.scale).toBeCloseTo((p.y - v.y) / v.scale)
  })
  it('does not zoom out past the fit, and comes back to the middle', () => {
    expect(zoomAt({ scale: 2, x: 50, y: 20 }, 0.1, { x: 0, y: 0 }, fitted, stage)).toEqual(FIT)
  })
  it('stops at the most it will zoom', () => {
    expect(zoomAt({ scale: 7, x: 0, y: 0 }, 10, { x: 0, y: 0 }, fitted, stage).scale).toBe(MAX_SCALE)
  })
})

describe('clampView', () => {
  it('holds a picture that fits the window in the middle', () => {
    expect(clampView({ scale: 1, x: 300, y: 300 }, fitted, stage)).toEqual({ scale: 1, x: 0, y: 0 })
  })
  it('lets a magnified one move only until its edge meets the window', () => {
    const v = clampView({ scale: 2, x: 9999, y: -9999 }, fitted, stage)
    expect(v.x).toBe((800 * 2 - 1000) / 2)
    expect(v.y).toBe(-(500 * 2 - 600) / 2)
  })
})

describe('wheelFactor', () => {
  it('zooms in on scrolling up and out on scrolling down', () => {
    expect(wheelFactor(-100, false)).toBeGreaterThan(1)
    expect(wheelFactor(100, false)).toBeLessThan(1)
  })
  it('steps a pinch more finely than it would a wheel notch of the same size', () => {
    expect(Math.abs(Math.log(wheelFactor(-5, true)))).toBeLessThan(Math.abs(Math.log(wheelFactor(-100, false))))
  })
})

describe('actualSize', () => {
  it('is one picture pixel per screen pixel', () => {
    expect(actualSize({ w: 2400, h: 1500 }, fitted)).toBe(3)
  })
  it('is still a step in for a picture already at its own size', () => {
    expect(actualSize({ w: 800, h: 500 }, fitted)).toBe(2)
  })
})
