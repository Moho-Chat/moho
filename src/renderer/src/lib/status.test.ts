import { describe, expect, it } from 'vitest'
import { statusesFor, statusName, supportsStatus } from './status'

describe('the statuses a service has', () => {
  it('gives Discord all four', () => {
    expect(statusesFor('discord')).toEqual(['online', 'idle', 'dnd', 'invisible'])
  })

  it('gives IRC away and back, and no invisible', () => {
    expect(statusesFor('irc')).toEqual(['online', 'idle', 'dnd'])
  })

  it('gives Matrix offline presence as invisible and no idle', () => {
    expect(statusesFor('matrix')).toEqual(['online', 'dnd', 'invisible'])
  })

  it('gives Kick and Sneedchat only the one that is moho\'s own', () => {
    expect(statusesFor('kick')).toEqual(['online', 'dnd'])
    expect(statusesFor('sneedchat')).toEqual(['online', 'dnd'])
    expect(supportsStatus('sneedchat', 'idle')).toBe(false)
  })
})

describe('what a status is called', () => {
  it('calls Matrix\'s invisible what it is, offline presence', () => {
    expect(statusName('matrix', 'invisible')).toBe('Offline')
    expect(statusName('discord', 'invisible')).toBe('Invisible')
    expect(statusName('matrix', 'dnd')).toBe('Do not disturb')
  })
})
