import { describe, expect, it } from 'vitest'
import { isNewerVersion } from './version'

describe('isNewerVersion', () => {
  it('compares each part as a number', () => {
    expect(isNewerVersion('1.0.10', '1.0.9')).toBe(true)
    expect(isNewerVersion('1.1.0', '1.0.9')).toBe(true)
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true)
    expect(isNewerVersion('1.0.9', '1.0.10')).toBe(false)
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
  })

  it('counts a release as newer than its own pre-releases', () => {
    expect(isNewerVersion('1.0.0', '1.0.0-rc.1')).toBe(true)
    expect(isNewerVersion('1.0.0', '1.0.1-rc.1')).toBe(false)
    expect(isNewerVersion('1.0.0', '0.1.0')).toBe(true)
  })

  it('is never true for something that is not a version', () => {
    expect(isNewerVersion('latest', '1.0.0')).toBe(false)
    expect(isNewerVersion('1.0', '0.1.0')).toBe(false)
    expect(isNewerVersion('1.0.0', 'dev')).toBe(false)
  })
})
