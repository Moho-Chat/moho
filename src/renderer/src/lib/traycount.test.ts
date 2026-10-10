import { describe, expect, it } from 'vitest'
import { trayCount } from './traycount'
import type { BufferEntry } from '../state/store'

const buf = (over: Partial<BufferEntry>): BufferEntry =>
  ({ id: 'a|#x', accountId: 'a', kind: 'channel', name: '#x', lastActivityTs: 0, groupId: 'g', unread: 0, highlight: false, mentions: 0, ...over }) as BufferEntry

describe('the number on the tray', () => {
  it('is nothing when nothing is waiting', () => {
    expect(trayCount([buf({}), buf({ id: 'a|#y', unread: 40 })], [], [], [])).toEqual({ dms: 0, mentions: 0, latest: null })
  })

  it('counts a channel by its mentions and not by its messages', () => {
    expect(trayCount([buf({ unread: 33, mentions: 2, highlight: true })], [], [], [])).toEqual({ dms: 0, mentions: 2, latest: 'a|#x' })
  })

  it('counts a direct message by each unread message in it', () => {
    expect(trayCount([buf({ id: 'a|bob', kind: 'dm', unread: 3 })], [], [], [])).toEqual({ dms: 3, mentions: 0, latest: 'a|bob' })
  })

  it('does not count what is muted or hidden, mentions included', () => {
    const rows = [buf({ id: 'a|#m', mentions: 4 }), buf({ id: 'a|#h', mentions: 5 }), buf({ id: 'a|gm', mentions: 6, groupId: 'muted-group' })]
    expect(trayCount(rows, ['a|#m'], ['a|#h'], ['muted-group'])).toEqual({ dms: 0, mentions: 0, latest: null })
    expect(trayCount([buf({ mentions: 2, serverMuted: true })], [], [], [])).toEqual({ dms: 0, mentions: 0, latest: null })
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
