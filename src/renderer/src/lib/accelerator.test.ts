import { describe, expect, it } from 'vitest'
import { acceleratorLabel, acceleratorOf } from './accelerator'

const press = (key: string, code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => ({
  key,
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods
})

describe('acceleratorOf', () => {
  it('writes the usual one the way Electron reads it', () => {
    expect(acceleratorOf(press('M', 'KeyM', { ctrlKey: true, shiftKey: true }))).toBe('Control+Shift+M')
  })
  it('waits while only modifiers are down', () => {
    expect(acceleratorOf(press('Control', 'ControlLeft', { ctrlKey: true }))).toBeNull()
  })
  it('refuses a bare key, which would be taken from every other program', () => {
    expect(acceleratorOf(press('m', 'KeyM'))).toBeNull()
  })
  it('names the key and not what shift makes of it', () => {
    expect(acceleratorOf(press('!', 'Digit1', { ctrlKey: true, shiftKey: true }))).toBe('Control+Shift+1')
  })
  it('knows arrows, function keys and the meta key', () => {
    expect(acceleratorOf(press('ArrowUp', 'ArrowUp', { altKey: true }))).toBe('Alt+Up')
    expect(acceleratorOf(press('F9', 'F9', { ctrlKey: true }))).toBe('Control+F9')
    expect(acceleratorOf(press('k', 'KeyK', { metaKey: true }))).toBe('Super+K')
  })
})

describe('acceleratorLabel', () => {
  it('splits it into the keys to draw', () => {
    expect(acceleratorLabel('Control+Shift+M')).toEqual(['Control', 'Shift', 'M'])
    expect(acceleratorLabel('Super+Return')).toEqual(['Meta', 'Enter'])
  })
})
