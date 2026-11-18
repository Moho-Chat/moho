import { describe, expect, it } from 'vitest'
import { accentProperties, resolveTheme } from './appearance'

describe('appearance', () => {
  it('follows the system only when left to it', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
  })
  it('sets nothing for the default accent, and a deeper colour on the light theme', () => {
    expect(accentProperties('blue', 'dark')).toEqual({})
    expect(accentProperties('nonsense', 'dark')).toEqual({})
    expect(accentProperties('teal', 'dark')['--primary']).toBe('#2ec4b6')
    expect(accentProperties('teal', 'light')['--primary']).toBe('#00796b')
  })
})
