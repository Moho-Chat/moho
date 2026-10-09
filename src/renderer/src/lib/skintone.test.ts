import { describe, expect, it } from 'vitest'
import { takesTone, withTone } from './skintone'

describe('withTone', () => {
  it('leaves the default alone', () => {
    expect(withTone('👍', 0)).toBe('👍')
  })
  it('adds the modifier for the tone chosen', () => {
    expect(withTone('👍', 1)).toBe('👍\u{1F3FB}')
    expect(withTone('👍', 5)).toBe('👍\u{1F3FF}')
  })
  it('drops the picture-form selector a tone replaces', () => {
    expect(withTone('✌️', 3)).toBe('✌\u{1F3FD}')
  })
  it('leaves what takes no tone as it was', () => {
    expect(withTone('🔥', 4)).toBe('🔥')
    expect(withTone('😂', 2)).toBe('😂')
  })
  it('ignores a tone it does not have', () => {
    expect(withTone('👍', 9)).toBe('👍')
  })
})

describe('takesTone', () => {
  it('knows the hands', () => {
    expect(takesTone('🙏')).toBe(true)
    expect(takesTone('✌️')).toBe(true)
    expect(takesTone('🔥')).toBe(false)
  })
})
