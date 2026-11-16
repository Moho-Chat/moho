import { describe, expect, it } from 'vitest'
import { byPlace, isUnreadMention, withRead } from './mentioninbox'

const marks = { lastRead: { a: 100 }, emptiedTs: 50, read: ['x'] }

describe('isUnreadMention', () => {
  it('waits until its conversation is read, the inbox is emptied, or it is ticked off', () => {
    expect(isUnreadMention({ id: 'm', ts: 120, bufferId: 'a' }, marks)).toBe(true)
    expect(isUnreadMention({ id: 'm', ts: 90, bufferId: 'a' }, marks)).toBe(false)
    expect(isUnreadMention({ id: 'm', ts: 40, bufferId: 'b' }, marks)).toBe(false)
    expect(isUnreadMention({ id: 'x', ts: 120, bufferId: 'b' }, marks)).toBe(false)
    expect(isUnreadMention({ id: 'm', ts: 60, bufferId: 'b' }, marks)).toBe(true)
  })
})

describe('withRead', () => {
  it('adds one once', () => {
    expect(withRead(['a'], 'b')).toEqual(['a', 'b'])
    expect(withRead(['a'], 'a')).toEqual(['a'])
  })
})

describe('byPlace', () => {
  it('keeps the order places first appear in', () => {
    expect(byPlace([1, 2, 3, 4], (n) => (n % 2 ? 'odd' : 'even'))).toEqual([
      { place: 'odd', items: [1, 3] },
      { place: 'even', items: [2, 4] }
    ])
  })
})
