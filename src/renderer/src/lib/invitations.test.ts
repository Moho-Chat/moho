import { describe, expect, it } from 'vitest'
import type { Account } from '../../../shared/wire'
import { INVITATIONS_GROUP_ID, invitationsGroup, isFixedEntry, orderedGroups, type RailGroup } from './groups'
import { currentInvitation, listInvitations, type InvitationSources } from './invitations'

const account = (id: string, service: Account['service']): Account => ({ id, service }) as Account

const accounts = [account('matrix:@me:x', 'matrix'), account('steam:me', 'steam'), account('discord:1', 'discord')]

const sources = (part: Partial<InvitationSources>): InvitationSources => ({ rooms: {}, friends: {}, discordFriends: {}, verification: null, ...part })
const room = { roomId: '!room:x', name: 'Room', inviter: 'alice', avatarUrl: null, isDirect: false }
const dm = { roomId: '!dm:x', name: 'Bob', inviter: 'bob', avatarUrl: 'mxc://x/b', isDirect: true }
const friend = { id: '76561197960287930', name: 'Some One', avatarUrl: 'https://example.test/a.jpg' }

describe('the invitations from every service', () => {
  const list = listInvitations(sources({ rooms: { 'matrix:@me:x': [room, dm] }, friends: { 'steam:me': [friend] } }), accounts)

  it('are one list, in the order the accounts are listed', () => {
    expect(list.map((i) => [i.service, i.kind, i.name])).toEqual([
      ['matrix', 'room', 'Room'],
      ['matrix', 'room', 'Bob'],
      ['steam', 'friend', 'Some One']
    ])
  })

  it('say what accepting makes: a conversation with a person, or a room', () => {
    expect(list.map((i) => i.direct)).toEqual([false, true, true])
  })

  it('say who is asking and for what', () => {
    expect(list[0].detail).toBe('alice invited you to this room')
    expect(list[1].detail).toBe('bob invited you to a direct message')
    expect(list[2].detail).toBe('wants to be your friend')
  })

  it('include the groups a Steam friend has invited the account to, as rooms', () => {
    const steam = listInvitations(sources({ rooms: { 'steam:me': [{ roomId: '78995476', name: 'Raiders', inviter: 'Gabe', avatarUrl: null, isDirect: false }] } }), accounts)
    expect(steam.map((i) => [i.service, i.kind, i.name, i.detail])).toEqual([['steam', 'room', 'Raiders', 'Gabe invited you to a group chat']])
  })

  it('are told apart by account and kind, so two with the same id are two', () => {
    const twin = listInvitations(sources({ rooms: { 'matrix:@me:x': [{ ...room, roomId: '7' }] }, friends: { 'steam:me': [{ id: '7', name: null }] } }), accounts)
    expect(new Set(twin.map((i) => i.key)).size).toBe(2)
  })

  it('call a person by their id until the service says who they are', () => {
    expect(listInvitations(sources({ friends: { 'steam:me': [{ id: '42', name: null }] } }), accounts)[0].name).toBe('42')
  })

  it('leave out an account that has gone', () => {
    expect(listInvitations(sources({ rooms: { 'matrix:@gone:x': [room] }, friends: { 'steam:gone': [friend] } }), accounts)).toEqual([])
  })

  it('take in the requests Discord keeps among its friends, and only the ones sent to us', () => {
    const found = listInvitations(
      sources({
        discordFriends: {
          'discord:1': [
            { userId: '1', username: 'pal', kind: 'friend' },
            { userId: '2', username: 'asker', globalName: 'Asker', kind: 'incoming' },
            { userId: '3', username: 'asked', kind: 'outgoing' },
            { userId: '4', username: 'plain' }
          ]
        }
      }),
      accounts
    )
    expect(found.map((i) => [i.service, i.kind, i.id, i.name])).toEqual([['discord', 'friend', '2', 'Asker']])
  })

  it('take in a Matrix verification only while it is waiting on an answer', () => {
    const verification = { accountId: 'matrix:@me:x', verificationId: 'v1', state: 'requested', otherUser: '@carol:x', isSelf: false, incoming: true }
    const waiting = listInvitations(sources({ verification }), accounts)
    expect(waiting.map((i) => [i.kind, i.name, i.detail])).toEqual([['verification', '@carol:x', 'wants to verify with you']])
    expect(listInvitations(sources({ verification: { ...verification, incoming: false } }), accounts)).toEqual([])
    // One we started is not an invitation to anybody.
    expect(listInvitations(sources({ verification: { ...verification, incoming: undefined } }), accounts)).toEqual([])
    // One of our own sessions is named as that, with the device.
    const mine = listInvitations(sources({ verification: { ...verification, isSelf: true, otherUser: undefined, otherDevice: 'Phone' } }), accounts)
    expect([mine[0].name, mine[0].detail]).toEqual(['Another of your sessions', 'wants to verify (Phone)'])
  })

  it('show the one chosen, or the first when none is or it has been answered', () => {
    expect(currentInvitation(list, list[2].key)?.name).toBe('Some One')
    expect(currentInvitation(list, 'gone')?.name).toBe('Room')
    expect(currentInvitation([], 'x')).toBeUndefined()
  })
})

describe('the invitations tile', () => {
  it('is one fixed tile that leads the rail, ahead of direct messages', () => {
    const tile = invitationsGroup(3)
    expect(tile.id).toBe(INVITATIONS_GROUP_ID)
    expect(tile.name).toBe('Invitations (3)')
    expect(invitationsGroup(1).name).toBe('Invitations')
    expect(isFixedEntry(tile)).toBe(true)
    const others = [
      { id: 'dm', kind: 'dms', position: -1000, name: 'Direct Messages' },
      { id: 'g', kind: 'guild', position: 1, name: 'g' }
    ] as RailGroup[]
    expect(orderedGroups([...others, tile], []).map((g) => g.id)).toEqual([INVITATIONS_GROUP_ID, 'dm', 'g'])
  })
})
