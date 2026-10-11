import { describe, expect, it } from 'vitest'
import { shouldOffer } from './matrixcall'

describe('which end of a Matrix call offers', () => {
  it('is exactly one end of every pair, whichever way round they ask', () => {
    // Both ends compute this about each other and must not agree, or the call
    // collides with itself.
    expect(shouldOffer('@a:example.org|AAA', '@b:example.org|BBB')).toBe(true)
    expect(shouldOffer('@b:example.org|BBB', '@a:example.org|AAA')).toBe(false)
  })

  it('tells two devices of the same person apart', () => {
    // The case that makes a user-id comparison alone wrong.
    expect(shouldOffer('@a:example.org|AAA', '@a:example.org|ZZZ')).toBe(true)
    expect(shouldOffer('@a:example.org|ZZZ', '@a:example.org|AAA')).toBe(false)
  })

  it('never has an end offer to itself', () => {
    expect(shouldOffer('@a:example.org|AAA', '@a:example.org|AAA')).toBe(false)
  })
})
