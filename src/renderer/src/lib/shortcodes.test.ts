import { describe, expect, it } from 'vitest'
import { rankShortcodes, shortcodeQuery, unicodeTargets } from './shortcodes'

const targets = unicodeTargets([
  { emoji: '🔥', name: 'fire lit hot' },
  { emoji: '👍', name: 'thumbs up yes approve' },
  { emoji: '🎉', name: 'party tada celebrate' }
])

describe('shortcodeQuery', () => {
  it('reads a word being typed after a colon', () => {
    expect(shortcodeQuery('nice :fi')).toBe('fi')
    expect(shortcodeQuery(':thumbs')).toBe('thumbs')
    expect(shortcodeQuery('(:fire')).toBe('fire')
  })
  it('leaves faces, times and links alone', () => {
    expect(shortcodeQuery('hi :)')).toBeNull()
    expect(shortcodeQuery('hi :f')).toBeNull()
    expect(shortcodeQuery('at 10:30')).toBeNull()
    expect(shortcodeQuery('see https://example')).toBeNull()
    expect(shortcodeQuery('done :fire: ')).toBeNull()
  })
})

describe('rankShortcodes', () => {
  it('finds by name and by any of its other words', () => {
    expect(rankShortcodes(targets, 'fir')[0].token).toBe('🔥')
    expect(rankShortcodes(targets, 'tada')[0].token).toBe('🎉')
  })
  it('puts a name before a nickname of something else', () => {
    const list = unicodeTargets([
      { emoji: '🎉', name: 'party fire' },
      { emoji: '🔥', name: 'fire lit' }
    ])
    expect(rankShortcodes(list, 'fire')[0].token).toBe('🔥')
  })
  it('shows nothing for what matches nothing', () => {
    expect(rankShortcodes(targets, 'zzzz')).toEqual([])
  })
})
