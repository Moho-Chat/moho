import { describe, expect, it } from 'vitest'
import {
  friendRequestGroup,
  inviteGroup,
  isFriendRequestEntry,
  readFriendRequestEntry,
  readInviteGroupId
} from './groups'

describe('friend requests in the rail', () => {
  const request = { id: '76561197960287930', name: 'Some One', avatarUrl: 'https://example.test/a.jpg' }

  it('stand as an invitation does, with the person behind the id', () => {
    const group = friendRequestGroup('steam:me', 'steam', request)
    expect(group.kind).toBe('invite')
    expect(group.service).toBe('steam')
    expect(group.name).toBe('Some One')
    expect(group.position).toBe(-2000)
    expect(isFriendRequestEntry(group.id)).toBe(true)
    expect(readFriendRequestEntry(group.id)).toEqual({ accountId: 'steam:me', personId: request.id })
  })

  it('are named by their id until Steam says who they are', () => {
    expect(friendRequestGroup('steam:me', 'steam', { id: '7', name: null }).name).toBe('7')
  })

  it('are not mistaken for a room, nor a room for them', () => {
    const room = inviteGroup('matrix:@me:x', { roomId: '!room:x', name: 'Room', inviter: null, avatarUrl: null, isDirect: false })
    expect(isFriendRequestEntry(room.id)).toBe(false)
    expect(readFriendRequestEntry(room.id)).toBeNull()
    expect(readFriendRequestEntry('account:steam:me')).toBeNull()
    // Still an invite entry, so selection and ordering treat it as one.
    expect(readInviteGroupId(friendRequestGroup('steam:me', 'steam', request).id)).not.toBeNull()
  })

  it('are told apart per account', () => {
    const a = friendRequestGroup('steam:a', 'steam', request).id
    const b = friendRequestGroup('steam:b', 'steam', request).id
    expect(a).not.toBe(b)
  })
})
