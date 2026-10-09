import { describe, expect, it } from 'vitest'
import { rankBuffers, type SwitcherBuffer } from './switcher'

const b = (id: string, name: string, extra: Partial<SwitcherBuffer> = {}): SwitcherBuffer => ({
  id,
  kind: 'channel',
  name,
  unread: 0,
  highlight: false,
  lastActivityTs: 100,
  ...extra
})
const whereOf = (x: SwitcherBuffer): string => (x.id.startsWith('d') ? 'Moho Dev' : 'libera')
const ids = (list: ReturnType<typeof rankBuffers<SwitcherBuffer>>): string[] => list.map((h) => h.buffer.id)

describe('the quick switcher ranking', () => {
  const all = [
    b('d1', 'Moho Dev/#general', { lastActivityTs: 500 }),
    b('d2', 'Moho Dev/#random', { unread: 3, lastActivityTs: 100 }),
    b('d3', 'Moho Dev/#clips', { unread: 1, highlight: true, lastActivityTs: 50 }),
    b('i1', '#archlinux', { lastActivityTs: 900 }),
    b('s1', 'libera', { kind: 'server', lastActivityTs: 1 })
  ]

  it('offers what is waiting first, mentions before plain unread, then the most recent', () => {
    expect(ids(rankBuffers(all, '', whereOf))).toEqual(['d3', 'd2', 'i1', 'd1'])
  })

  it('leaves out the server buffers', () => {
    expect(ids(rankBuffers(all, 'libera', whereOf))).not.toContain('s1')
  })

  it('prefers a name that starts with the word, then one that has it at a word, then one that has it somewhere', () => {
    const list = [b('a', '#xdev'), b('b', '#my-dev-room'), b('c', '#dev-ops'), b('e', '#deploy-vendor')]
    expect(ids(rankBuffers(list, 'dev', whereOf))).toEqual(['c', 'b', 'a', 'e'])
  })

  it('wants every word, in the name or the place', () => {
    expect(ids(rankBuffers(all, 'moho clips', whereOf))).toEqual(['d3'])
    expect(ids(rankBuffers(all, 'general libera', whereOf))).toEqual([])
  })

  it('finds a name by its letters in order, but not out of order', () => {
    expect(ids(rankBuffers(all, 'gnrl', whereOf))).toEqual(['d1'])
    expect(ids(rankBuffers(all, 'lnrg', whereOf))).toEqual([])
  })

  it('breaks a tie by what is waiting', () => {
    const list = [b('a', '#chat-one'), b('b', '#chat-two', { unread: 2 })]
    expect(ids(rankBuffers(list, 'chat', whereOf))[0]).toBe('b')
  })

  it('puts an exact name above a longer one that starts with it', () => {
    const list = [b('a', '#chat-two', { unread: 2 }), b('b', '#chat')]
    expect(ids(rankBuffers(list, 'chat', whereOf))[0]).toBe('b')
  })

  it('ignores case and the # that names the channel', () => {
    expect(ids(rankBuffers(all, 'ARCH', whereOf))).toEqual(['i1'])
    expect(rankBuffers(all, 'arch', whereOf)[0].title).toBe('archlinux')
  })
})
