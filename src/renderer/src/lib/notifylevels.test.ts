import { describe, expect, it } from 'vitest'
import { appliedLevelOf, heldOnAccount, levelLabel, levelOf, notifyLevelsFor } from './notifylevels'

describe('which levels a service can keep', () => {
  const room = { kind: 'channel' } as const
  const person = { kind: 'dm' } as const

  it('offers all four where the service has a setting for every one, or the daemon keeps it', () => {
    for (const service of ['matrix', 'discord', 'stoat', 'irc', 'twitch', 'kick', 'sneedchat', undefined]) {
      expect(notifyLevelsFor(service, room)).toEqual(['default', 'all', 'mentions', 'mute'])
    }
  })

  it('offers Telegram only what it keeps for a chat: muted or not', () => {
    expect(notifyLevelsFor('telegram', room)).toEqual(['default', 'mute'])
    expect(notifyLevelsFor('telegram', person)).toEqual(['default', 'mute'])
  })

  it('offers a Steam group room its three and a friend only muted or not', () => {
    expect(notifyLevelsFor('steam', room)).toEqual(['all', 'mentions', 'mute'])
    expect(notifyLevelsFor('steam', person)).toEqual(['default', 'mute'])
  })
})

describe('the account holds it', () => {
  it('for the five services with a setting of their own, and not for the rest', () => {
    for (const held of ['matrix:@a:b', 'discord:1', 'stoat:x', 'steam:7656', 'telegram:42']) expect(heldOnAccount(held)).toBe(true)
    for (const local of ['irc:libera', 'twitch:x', 'kick:y', 'sneedchat:z']) expect(heldOnAccount(local)).toBe(false)
  })
})

describe('what a conversation is set to', () => {
  it('is the default when the daemon says nothing, and applies as set unless told otherwise', () => {
    expect(levelOf({})).toBe('default')
    expect(levelOf({ notify: 'mentions' })).toBe('mentions')
    expect(appliedLevelOf({ notify: 'all' })).toBe('all')
    // Left on its default inside a muted server: ticked as default, silent.
    expect(appliedLevelOf({ notifyApplied: 'mute' })).toBe('mute')
    expect(levelOf({ notifyApplied: 'mute' })).toBe('default')
  })

  it('is called what Element calls it for Matrix, and something plainer elsewhere', () => {
    expect(levelLabel('mentions', 'matrix', 'channel')).toBe('Mentions and keywords')
    expect(levelLabel('mentions', 'irc', 'channel')).toBe('Mentions only')
    expect(levelLabel('default', 'matrix', 'channel')).toBe('Match default settings')
    expect(levelLabel('mute', 'matrix', 'dm')).toBe('Mute room')
    expect(levelLabel('mute', 'irc', 'dm')).toBe('Mute conversation')
    expect(levelLabel('mute', 'irc', 'channel')).toBe('Mute channel')
  })
})
