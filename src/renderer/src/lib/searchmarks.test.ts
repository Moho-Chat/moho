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
