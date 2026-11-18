import { describe, expect, it } from 'vitest'
import { fractionOf, pollWinners, stageOf } from './livecards'

const opt = (id: string, votes: number, winner = false) => ({ id, label: id, votes, winner })

describe('where a poll or prediction is', () => {
  it("takes the service's word for it, whatever its case", () => {
    expect(stageOf({ kind: 'prediction', state: 'LOCKED', options: [] }, true)).toBe('locked')
    expect(stageOf({ kind: 'prediction', state: 'RESOLVED', options: [] }, false)).toBe('decided')
    expect(stageOf({ kind: 'prediction', state: 'CANCELLED', options: [] }, false)).toBe('cancelled')
    expect(stageOf({ kind: 'prediction', state: 'canceled', options: [] }, false)).toBe('cancelled')
  })

  it('is decided once a winner is named, and otherwise goes by the clock', () => {
    expect(stageOf({ kind: 'prediction', state: null, options: [opt('a', 1, true)] }, true)).toBe('decided')
    expect(stageOf({ kind: 'prediction', state: 'active', options: [] }, true)).toBe('open')
    expect(stageOf({ kind: 'prediction', state: null, options: [] }, false)).toBe('locked')
    expect(stageOf({ kind: 'poll', state: null, options: [] }, false)).toBe('decided')
  })
})

describe("a poll's winners", () => {
  it('are the answers with the most votes, both of a tie, and nobody without votes', () => {
    expect(pollWinners({ options: [opt('a', 3), opt('b', 5)] })).toEqual(['b'])
    expect(pollWinners({ options: [opt('a', 4), opt('b', 4), opt('c', 1)] })).toEqual(['a', 'b'])
    expect(pollWinners({ options: [opt('a', 0), opt('b', 0)] })).toEqual([])
    expect(pollWinners({ options: [opt('a', 9), opt('b', 1, true)] })).toEqual(['b'])
  })
})

describe('the ⅛ ¼ ½ All buttons', () => {
  it('give whole points and never less than the smallest bet', () => {
    expect(fractionOf(12840, 1 / 2, 10)).toBe(6420)
    expect(fractionOf(12840, 1 / 8, 10)).toBe(1605)
    expect(fractionOf(12840, 1, 10)).toBe(12840)
    expect(fractionOf(40, 1 / 8, 10)).toBe(10)
  })
})
