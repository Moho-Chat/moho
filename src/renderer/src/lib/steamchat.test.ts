import { describe, expect, it } from 'vitest'
import { steamGroupInviteCode, steamGroupOfRail, steamRoomIds } from './steamchat'

describe('Steam chat groups', () => {
  it('tells a group on the rail from every other entry', () => {
    expect(steamGroupOfRail('steam:me|steamgroup:78989756')).toBe('78989756')
    expect(steamGroupOfRail('steam:me|guild:5')).toBeNull()
    expect(steamGroupOfRail('steam:me|steamgroup:')).toBeNull()
  })

  it('finds the group and room a channel is, and nothing in a friend conversation', () => {
    expect(steamRoomIds({ kind: 'channel', remoteId: '78989756:316198645' })).toEqual({ group: '78989756', room: '316198645' })
    expect(steamRoomIds({ kind: 'dm', remoteId: '76561197960265729' })).toBeNull()
    expect(steamRoomIds({ kind: 'channel', remoteId: 'x:y' })).toBeNull()
    expect(steamRoomIds(undefined)).toBeNull()
  })

  it('reads the invitation to a group out of a link, and refuses what is not one', () => {
    expect(steamGroupInviteCode('https://s.team/chat/Ga3kODnC')).toBe('Ga3kODnC')
    expect(steamGroupInviteCode(' s.team/chat/Ga3kODnC ')).toBe('Ga3kODnC')
    expect(steamGroupInviteCode('https://steamcommunity.com/chat/invite/Ga3kODnC?x=1')).toBe('Ga3kODnC')
    expect(steamGroupInviteCode('https://s.team/p/abc-def/XYZ')).toBeNull()
    expect(steamGroupInviteCode('someone')).toBeNull()
  })
})
