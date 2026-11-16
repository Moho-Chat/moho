import { describe, expect, it } from 'vitest'
import { isRoomEvent, markMatches } from './searchmarks'

describe('markMatches', () => {
  it('marks each word of the query, in any case', () => {
    expect(markMatches('The Owl and the owlet', 'owl')).toEqual([
      { text: 'The ', hit: false },
      { text: 'Owl', hit: true },
      { text: ' and the ', hit: false },
      { text: 'owl', hit: true },
      { text: 'et', hit: false }
    ])
  })
  it('marks nothing for filters alone, and is not upset by punctuation', () => {
    expect(markMatches('from grace', 'from:grace')).toEqual([{ text: 'from grace', hit: false }])
    expect(markMatches('a (b) c', '(b)')).toEqual([
      { text: 'a ', hit: false },
      { text: '(b)', hit: true },
      { text: ' c', hit: false }
    ])
  })
})

describe('isRoomEvent', () => {
  it('knows comings and goings from things said', () => {
    expect(isRoomEvent({ kind: 'join' })).toBe(true)
    expect(isRoomEvent({ kind: 'matrixQuit' })).toBe(true)
    expect(isRoomEvent({ kind: 'chat' })).toBe(false)
    expect(isRoomEvent({ kind: 'system' })).toBe(false)
  })
})

import { eventRuns, runSummary } from './searchmarks'
describe('eventRuns', () => {
  const m = (kind: string, ts = 1): { kind: string; ts: number } => ({ kind, ts })
  const sameDay = (a: number, b: number): boolean => Math.floor(a / 100) === Math.floor(b / 100)
  it('folds three or more comings and goings in a row, and no fewer', () => {
    const log = [m('chat'), m('join'), m('part'), m('chat'), m('join'), m('quit'), m('matrixJoin'), m('nick'), m('chat')]
    const runs = eventRuns(log, sameDay)
    expect(runs.has(1)).toBe(false)
    expect(runs.get(4)).toEqual({ first: 4, last: 7, joined: 2, left: 1, other: 1 })
    expect(runs.get(7)).toBe(runs.get(4))
    expect(runSummary(runs.get(4)!)).toBe('2 joined, 1 left, 1 other change')
  })
  it('does not run across midnight', () => {
    const runs = eventRuns([m('join', 90), m('join', 95), m('join', 105), m('join', 110)], sameDay)
    expect(runs.size).toBe(0)
  })
})
