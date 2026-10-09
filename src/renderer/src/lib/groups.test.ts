import { describe, expect, it } from 'vitest'
import type { BufferEntry } from '../state/store'
import {
  compareInBand,
  countsTowardRail,
  fileInFolder,
  foldTogether,
  orderedGroups,
  railEntries,
  removeFromFolders,
  reorder,
  reorderFolder,
  type RailFolder,
  type RailGroup
} from './groups'

const group = (id: string, kind = 'guild', position = 0, name = id): RailGroup =>
  ({ id, kind, position, name }) as RailGroup

describe('the server rail', () => {
  const groups = [group('b', 'guild', 2), group('pin', 'pinned'), group('a', 'guild', 1), group('dm', 'dms'), group('c', 'guild', 3)]

  it('puts direct messages first and the fixed entries above everything movable', () => {
    expect(orderedGroups(groups, []).map((g) => g.id)).toEqual(['dm', 'pin', 'a', 'b', 'c'])
  })

  it('follows the saved order, and puts groups it has never seen after it', () => {
    expect(orderedGroups(groups, ['c', 'a']).map((g) => g.id)).toEqual(['dm', 'pin', 'c', 'a', 'b'])
  })

  it('moves a dragged group to where it was dropped, never moving the fixed ones', () => {
    const ordered = orderedGroups(groups, [])
    expect(reorder(ordered, 'c', 'a')).toEqual(['c', 'a', 'b'])
    expect(reorder(ordered, 'dm', 'a')).toEqual(['a', 'b', 'c'])
    expect(reorder(ordered, 'a', 'a')).toEqual(['a', 'b', 'c'])
  })

  it('moves a folder as one block', () => {
    const ordered = orderedGroups(groups, [])
    const folder: RailFolder = { id: 'f', name: 'F', members: ['b', 'c'] }
    expect(reorderFolder(ordered, folder, 'a')).toEqual(['b', 'c', 'a'])
    // Dropped onto one of its own members: nothing moves.
    expect(reorderFolder(ordered, folder, 'c')).toEqual(['a', 'b', 'c'])
  })
})

describe('folders', () => {
  const ordered = [group('a'), group('b'), group('c'), group('d')]

  it('sits where its first member is, and keeps the rest of the column in order', () => {
    const entries = railEntries(ordered, [{ id: 'f', name: 'F', members: ['c', 'b'] }])
    expect(entries.map((e) => e.id)).toEqual(['a', 'f', 'd'])
    const folder = entries[1]
    expect(folder.kind === 'folder' && folder.members.map((g) => g.id)).toEqual(['c', 'b'])
  })

  it('still shows a folder whose servers are all gone', () => {
    expect(railEntries([], [{ id: 'f', name: 'F', members: ['gone'] }]).map((e) => e.id)).toEqual(['f'])
  })

  it('makes a folder of two, or adds to the folder already there', () => {
    const made = foldTogether([], 'a', 'b')
    expect(made).toHaveLength(1)
    expect(made[0].members).toEqual(['a', 'b'])
    const added = foldTogether(made, 'a', 'c')
    expect(added).toHaveLength(1)
    expect(added[0].members).toEqual(['a', 'b', 'c'])
  })

  it('keeps a server in one folder at a time', () => {
    const folders: RailFolder[] = [
      { id: 'x', name: 'X', members: ['a', 'b'] },
      { id: 'y', name: 'Y', members: ['c'] }
    ]
    const moved = fileInFolder(folders, 'y', 'a')
    expect(moved.find((f) => f.id === 'x')?.members).toEqual(['b'])
    expect(moved.find((f) => f.id === 'y')?.members).toEqual(['c', 'a'])
    expect(removeFromFolders(moved, 'c').find((f) => f.id === 'y')?.members).toEqual(['a'])
  })
})

describe('what a muted place still says', () => {
  const buf = (extra: Partial<BufferEntry>): BufferEntry =>
    ({ id: 'a|#x', accountId: 'a', kind: 'channel', name: '#x', lastActivityTs: 0, groupId: 'g', unread: 3, highlight: false, ...extra }) as BufferEntry

  it('counts a quiet muted channel for nothing', () => {
    expect(countsTowardRail(buf({}), ['a|#x'], [])).toBe(false)
    expect(countsTowardRail(buf({}), [], [], ['g'])).toBe(false)
  })

  it('still counts it once somebody has used your name', () => {
    expect(countsTowardRail(buf({ highlight: true }), ['a|#x'], [])).toBe(true)
    expect(countsTowardRail(buf({ highlight: true }), [], [], ['g'])).toBe(true)
  })

  it('never counts what has no row to click through to', () => {
    expect(countsTowardRail(buf({ highlight: true }), [], ['a|#x'])).toBe(false)
  })
})

describe('compareInBand', () => {
  const ch = (name: string, lastActivityTs: number, position = 0) => ({ kind: 'channel' as const, name, lastActivityTs, position })
  const dm = (name: string, lastActivityTs: number) => ({ kind: 'dm' as const, name, lastActivityTs, position: 0 })

  it('keeps channels where they are however recently they spoke', () => {
    const list = [ch('#zebra', 100), ch('#alpha', 5), ch('#mid', 50)]
    expect(list.sort(compareInBand).map((c) => c.name)).toEqual(['#alpha', '#mid', '#zebra'])
    // A message arriving changes nothing about the order.
    list[0] = ch('#alpha', 9999)
    expect(list.sort(compareInBand).map((c) => c.name)).toEqual(['#alpha', '#mid', '#zebra'])
  })

  it("follows the service's own position before the name", () => {
    expect([ch('#a', 0, 2), ch('#b', 0, 1)].sort(compareInBand).map((c) => c.name)).toEqual(['#b', '#a'])
  })

  it('still puts the person who just wrote first among direct messages', () => {
    expect([dm('old', 1), dm('new', 9)].sort(compareInBand).map((c) => c.name)).toEqual(['new', 'old'])
  })
})
