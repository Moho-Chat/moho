import { describe, expect, it } from 'vitest'
import type { Account } from '../../../shared/wire'
import { INVITATIONS_GROUP_ID, invitationsGroup, isFixedEntry, orderedGroups, type RailGroup } from './groups'
import { currentInvitation, listInvitations } from './invitations'

const account = (id: string, service: Account['service']): Account => ({ id, service }) as Account

const accounts = [account('matrix:@me:x', 'matrix'), account('steam:me', 'steam')]
const room = { roomId: '!room:x', name: 'Room', inviter: 'alice', avatarUrl: null, isDirect: false }
const dm = { roomId: '!dm:x', name: 'Bob', inviter: 'bob', avatarUrl: 'mxc://x/b', isDirect: true }
const friend = { id: '76561197960287930', name: 'Some One', avatarUrl: 'https://example.test/a.jpg' }

describe('the invitations from every service', () => {
  const list = listInvitations({ 'matrix:@me:x': [room, dm] }, { 'steam:me': [friend] }, accounts)

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

  it('are told apart by account and kind, so two with the same id are two', () => {
    const twin = listInvitations({ 'matrix:@me:x': [{ ...room, roomId: '7' }] }, { 'steam:me': [{ id: '7', name: null }] }, accounts)
    expect(new Set(twin.map((i) => i.key)).size).toBe(2)
  })

  it('call a person by their id until the service says who they are', () => {
    expect(listInvitations({}, { 'steam:me': [{ id: '42', name: null }] }, accounts)[0].name).toBe('42')
  })

  it('leave out an account that has gone', () => {
    expect(listInvitations({ 'matrix:@gone:x': [room] }, { 'steam:gone': [friend] }, accounts)).toEqual([])
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
