import { describe, expect, it } from 'vitest'
import { trayCount } from './traycount'
import type { BufferEntry } from '../state/store'

const buf = (over: Partial<BufferEntry>): BufferEntry =>
  ({ id: 'a|#x', accountId: 'a', kind: 'channel', name: '#x', lastActivityTs: 0, groupId: 'g', unread: 0, highlight: false, mentions: 0, ...over }) as BufferEntry

describe('the number on the tray', () => {
  it('is nothing when nothing is waiting', () => {
    expect(trayCount([buf({}), buf({ id: 'a|#y', unread: 40 })], [], [], [])).toMatchObject({ dms: 0, mentions: 0, latest: null })
  })

  it('counts a channel by its mentions and not by its messages', () => {
    expect(trayCount([buf({ unread: 33, mentions: 2, highlight: true })], [], [], [])).toMatchObject({ dms: 0, mentions: 2, latest: 'a|#x' })
  })

  it('counts a direct message by each unread message in it', () => {
    expect(trayCount([buf({ id: 'a|bob', kind: 'dm', unread: 3 })], [], [], [])).toMatchObject({ dms: 3, mentions: 0, latest: 'a|bob' })
  })

  it('does not count what is hidden', () => {
    expect(trayCount([buf({ id: 'a|#h', mentions: 5 })], [], ['a|#h'], [])).toMatchObject({ dms: 0, mentions: 0, latest: null })
  })

  it('counts the mentions in what is muted, and nothing else there', () => {
    const rows = [buf({ id: 'a|#m', mentions: 4, unread: 90 }), buf({ id: 'a|gm', mentions: 6, groupId: 'muted-group' })]
    expect(trayCount(rows, ['a|#m'], [], ['muted-group'])).toMatchObject({ dms: 0, mentions: 10, latest: 'a|#m' })
    expect(trayCount([buf({ mentions: 2, notify: 'mute' })], [], [], [])).toMatchObject({ mentions: 2 })
    expect(trayCount([buf({ unread: 50, notify: 'mute' })], [], [], [])).toMatchObject({ mentions: 0 })
  })

  it('counts a muted direct message for nothing', () => {
    expect(trayCount([buf({ id: 'a|bob', kind: 'dm', unread: 3 })], ['a|bob'], [], [])).toMatchObject({ dms: 0, mentions: 0, latest: null })
  })

  it('lists what is waiting by name, most recent first, for the tray to name', () => {
    const rows = [buf({ id: 'a|#old', name: '#old', mentions: 1, lastActivityTs: 10 }), buf({ id: 'a|bob', name: 'bob', kind: 'dm', unread: 2, lastActivityTs: 20 })]
    expect(trayCount(rows, [], [], []).waiting).toEqual([
      { id: 'a|bob', name: 'bob', count: 2, direct: true },
      { id: 'a|#old', name: '#old', count: 1, direct: false }
    ])
  })

  it('names the most recently active conversation that has something, for the tray to open', () => {
    const rows = [buf({ id: 'a|old', mentions: 1, lastActivityTs: 10 }), buf({ id: 'a|new', mentions: 1, lastActivityTs: 20 }), buf({ id: 'a|quiet', lastActivityTs: 99 })]
    expect(trayCount(rows, [], [], []).latest).toBe('a|new')
  })

  it('adds the two kinds together and keeps them apart', () => {
    const rows = [buf({ id: 'a|bob', kind: 'dm', unread: 2 }), buf({ mentions: 3 })]
    expect(trayCount(rows, [], [], [])).toMatchObject({ dms: 2, mentions: 3 })
  })
})
