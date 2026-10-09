import { describe, expect, it } from 'vitest'
import { presenceClass, presenceKind, presenceLabel } from './presence'

describe('how a state is shown', () => {
  it('has one answer for every word a service uses', () => {
    expect(presenceKind('online')).toBe('online')
    expect(presenceKind('connected')).toBe('online')
    expect(presenceKind('idle')).toBe('idle')
    expect(presenceKind('dnd')).toBe('dnd')
    expect(presenceKind('connecting')).toBe('connecting')
    expect(presenceKind('disconnected')).toBe('offline')
    expect(presenceKind(undefined)).toBe('offline')
    expect(presenceKind('something new')).toBe('offline')
  })

  it('does not call a connection being made offline', () => {
    expect(presenceLabel('connecting')).toBe('Connecting…')
    expect(presenceLabel('away')).toBe('Offline')
  })

  it('names the class the stylesheet draws it by', () => {
    expect(presenceClass('dnd')).toBe('presence-dnd')
    expect(presenceClass('whatever')).toBe('presence-offline')
  })
})
