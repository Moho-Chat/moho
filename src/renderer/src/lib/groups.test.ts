import { describe, expect, it } from 'vitest'
import type { BufferEntry } from '../state/store'
import {
  badgesShown,
  compareInBand,
  countedFor,
  dissolveFolder,
  fileNewServers,
  folderRef,
  foldTogether,
  moveInRail,
  orderedGroups,
  railEntries,
  waitingCount,
  type RailEntry,
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
    const layout = { order: [], folders: [] }
    expect(moveInRail(ordered, layout, 'c', { kind: 'beside', target: 'a', after: false }).order).toEqual(['c', 'a', 'b'])
    expect(moveInRail(ordered, layout, 'a', { kind: 'beside', target: 'c', after: true }).order).toEqual(['b', 'c', 'a'])
    expect(moveInRail(ordered, layout, 'a', { kind: 'beside', target: 'a', after: false })).toBe(layout)
  })

  it('remembers where servers it cannot see right now were', () => {
    const ordered = orderedGroups(groups, ['offline', 'a', 'b', 'c'])
    expect(moveInRail(ordered, { order: ['offline', 'a', 'b', 'c'], folders: [] }, 'c', { kind: 'beside', target: 'a', after: false }).order).toEqual(['c', 'a', 'b', 'offline'])
  })

  it('moves a folder as one block', () => {
    const ordered = orderedGroups(groups, [])
    const folders: RailFolder[] = [{ id: 'f', name: 'F', members: ['b', 'c'] }]
    const moved = moveInRail(ordered, { order: [], folders }, folderRef('f'), { kind: 'beside', target: 'a', after: false })
    expect(moved.order).toEqual(['b', 'c', 'a'])
    expect(railEntries(orderedGroups(groups, moved.order), moved.folders).map((e) => e.id)).toEqual(['dm', 'pin', 'f', 'a'])
  })
})

/** The rail as an outline: a folder is its id with what it holds in brackets. */
const outline = (entries: RailEntry[]): string[] =>
  entries.map((e) =>
    e.kind === 'group' ? e.id : `${e.head ? `${e.head.id}:` : ''}${e.id}[${outline(e.children).join(' ')}]`
  )

describe('folders', () => {
  const ordered = [group('a'), group('b'), group('c'), group('d')]
  const layoutOf = (folders: RailFolder[], order: string[] = []) => ({ order, folders })

  it('sits where its first member is, and keeps the rest of the column in order', () => {
    const entries = railEntries(ordered, [{ id: 'f', name: 'F', members: ['c', 'b'] }])
    expect(entries.map((e) => e.id)).toEqual(['a', 'f', 'd'])
    const folder = entries[1]
    expect(folder.kind === 'folder' && folder.members.map((g) => g.id)).toEqual(['c', 'b'])
  })

  it('still shows a folder whose servers are all gone', () => {
    expect(railEntries([], [{ id: 'f', name: 'F', members: ['gone'] }]).map((e) => e.id)).toEqual(['f'])
  })

  it('makes a folder of two, in the place of the one already there', () => {
    const made = foldTogether(ordered, layoutOf([]), 'b', 'd', [], 'n')
    expect(made.folders).toEqual([{ id: 'n', name: 'New folder', members: ['b', 'd'] }])
    expect(outline(railEntries(orderedGroups(ordered, made.order), made.folders))).toEqual(['a', 'n[b d]', 'c'])
  })

  it('makes a folder inside a folder when two inside it are dropped together', () => {
    const made = foldTogether(ordered, layoutOf([{ id: 'f', name: 'F', members: ['a', 'b', 'c'] }]), 'b', 'c', [], 'n')
    expect(outline(railEntries(ordered, made.folders))).toEqual(['f[a n[b c]]', 'd'])
  })

  it('keeps a server in one folder at a time', () => {
    const folders: RailFolder[] = [
      { id: 'x', name: 'X', members: ['a', 'b'] },
      { id: 'y', name: 'Y', members: ['c'] }
    ]
    const moved = moveInRail(ordered, layoutOf(folders), 'a', { kind: 'into', folder: 'y' })
    expect(moved.folders.find((f) => f.id === 'x')?.members).toEqual(['b'])
    expect(moved.folders.find((f) => f.id === 'y')?.members).toEqual(['c', 'a'])
  })

  it('puts something dropped beside a server in a folder into that folder, beside it', () => {
    const moved = moveInRail(ordered, layoutOf([{ id: 'f', name: 'F', members: ['a', 'b'] }]), 'd', { kind: 'beside', target: 'a', after: true })
    expect(outline(railEntries(ordered, moved.folders))).toEqual(['f[a d b]', 'c'])
  })

  it('takes a server out of its folder and puts it last when dropped below the column', () => {
    const moved = moveInRail(ordered, layoutOf([{ id: 'f', name: 'F', members: ['a', 'b'] }]), 'a', { kind: 'end' })
    expect(outline(railEntries(orderedGroups(ordered, moved.order), moved.folders))).toEqual(['f[b]', 'c', 'd', 'a'])
  })

  it('nests one folder inside another, and never one inside itself', () => {
    const folders: RailFolder[] = [
      { id: 'x', name: 'X', members: ['a'] },
      { id: 'y', name: 'Y', members: ['c'] }
    ]
    const nested = moveInRail(ordered, layoutOf(folders), folderRef('y'), { kind: 'into', folder: 'x' })
    expect(outline(railEntries(ordered, nested.folders))).toEqual(['x[a y[c]]', 'b', 'd'])
    // Back the other way would put x inside something that is inside x.
    expect(moveInRail(ordered, nested, folderRef('x'), { kind: 'into', folder: 'y' })).toBe(nested)
    expect(moveInRail(ordered, nested, folderRef('x'), { kind: 'beside', target: 'c', after: false })).toBe(nested)
  })

  it('leaves what a removed folder held where it was, nested folders included', () => {
    const folders: RailFolder[] = [
      { id: 'x', name: 'X', members: ['a', folderRef('y'), 'b'] },
      { id: 'y', name: 'Y', members: ['c'] }
    ]
    const gone = dissolveFolder(ordered, layoutOf(folders), 'x')
    expect(outline(railEntries(orderedGroups(ordered, gone.order), gone.folders))).toEqual(['a', 'y[c]', 'b', 'd'])
    const inner = dissolveFolder(ordered, layoutOf(folders), 'y')
    expect(outline(railEntries(ordered, inner.folders))).toEqual(['x[a c b]', 'd'])
  })
})

describe('protocol badges as folders', () => {
  const stoat = (id: string, kind = 'guild') => ({ ...group(id, kind), accountId: 'stoat' }) as RailGroup
  const acct = stoat('account:stoat', 'account')
  const groups = [group('a'), acct, stoat('s1'), stoat('s2')]

  it('files a server the account joins under its badge, and not one the rail already placed', () => {
    const filed = fileNewServers(groups, { order: ['s1'], folders: [] })!
    expect(filed).toEqual([{ id: 'badge:account:stoat', name: 'account:stoat', members: ['s2'], head: 'account:stoat' }])
    expect(fileNewServers(groups, { order: ['s1'], folders: filed })).toBeNull()
    expect(outline(railEntries(groups, filed))).toEqual(['a', 'account:stoat:badge:account:stoat[s2]', 's1'])
  })

  it('remembers a server taken out of its badge, so it is not filed back', () => {
    const folders = fileNewServers(groups, { order: [], folders: [] })!
    const out = moveInRail(groups, { order: [], folders }, 's1', { kind: 'end' })
    expect(outline(railEntries(orderedGroups(groups, out.order), out.folders))).toEqual(['a', 'account:stoat:badge:account:stoat[s2]', 's1'])
    expect(fileNewServers(groups, out)).toBeNull()
    // And back in.
    const back = moveInRail(groups, out, 's1', { kind: 'into', folder: 'badge:account:stoat' })
    expect(outline(railEntries(groups, back.folders))).toEqual(['a', 'account:stoat:badge:account:stoat[s2 s1]'])
  })

  it('nests inside a folder with everything under it', () => {
    const folders = fileNewServers(groups, { order: [], folders: [] })!
    const made = foldTogether(groups, { order: [], folders }, 'a', folderRef('badge:account:stoat'), [], 'n')
    expect(outline(railEntries(orderedGroups(groups, made.order), made.folders))).toEqual([
      'n[a account:stoat:badge:account:stoat[s1 s2]]'
    ])
  })

  it('becomes the folder wherever its account tile had been filed before it held anything', () => {
    const folders = fileNewServers(groups, { order: [], folders: [{ id: 'n', name: 'N', members: ['a', 'account:stoat'] }] })!
    expect(outline(railEntries(groups, folders))).toEqual(['n[a account:stoat:badge:account:stoat[s1 s2]]'])
  })

  it('is shown while the account has servers, though it has nothing of its own', () => {
    const folders = fileNewServers(groups, { order: [], folders: [] })!
    const shown = groups.filter((g) => g.kind !== 'account')
    expect(badgesShown(groups, shown, folders).map((g) => g.id)).toEqual(['account:stoat'])
    // With nothing in it, and every server placed elsewhere: still its badge.
    const placed = moveInRail(groups, { order: [], folders }, 's1', { kind: 'end' })
    const emptied = moveInRail(groups, placed, 's2', { kind: 'end' })
    expect(badgesShown(groups, shown, emptied.folders).map((g) => g.id)).toEqual(['account:stoat'])
    // An account with no servers and nothing of its own has no tile at all.
    expect(badgesShown([group('a'), acct], [group('a')], [])).toEqual([])
  })

  it("shows the protocol's mark, not the account's picture", () => {
    const pictured = [group('a'), { ...acct, iconUrl: '/avatar.png' } as RailGroup, stoat('s1')]
    const folders = fileNewServers(pictured, { order: [], folders: [] })!
    const [badge] = railEntries(pictured, folders).filter((e) => e.kind === 'folder')
    expect(badge.kind === 'folder' && badge.head?.id).toBe('account:stoat')
    expect(badge.kind === 'folder' && badge.head?.iconUrl).toBeUndefined()
  })

  it('is made for an account whose servers were all placed before badges existed', () => {
    const folders = fileNewServers(groups, { order: ['s1', 's2'], folders: [] })!
    expect(folders).toEqual([{ id: 'badge:account:stoat', name: 'account:stoat', members: [], head: 'account:stoat' }])
    expect(outline(railEntries(groups, folders))).toEqual(['a', 'account:stoat:badge:account:stoat[]', 's1', 's2'])
  })

  it('is emptied, not removed, when everything is taken out', () => {
    const folders = fileNewServers(groups, { order: [], folders: [] })!
    const emptied = dissolveFolder(groups, { order: [], folders }, 'badge:account:stoat')
    expect(emptied.folders).toEqual([{ ...folders[0], members: [] }])
    expect(emptied.order).toEqual(['a', 'account:stoat', 's1', 's2'])
    expect(fileNewServers(groups, emptied)).toBeNull()
  })
})

describe('what a muted place still says', () => {
  const buf = (extra: Partial<BufferEntry>): BufferEntry =>
    ({ id: 'a|#x', accountId: 'a', kind: 'channel', name: '#x', lastActivityTs: 0, groupId: 'g', unread: 3, highlight: false, mentions: 0, ...extra }) as BufferEntry

  it('counts what a conversation is set to the way it interrupts: mentions only counts mentions even in a direct message, and every message counts every one', () => {
    const dm = (extra: Record<string, unknown>) => buf({ kind: 'dm', unread: 7, mentions: 1, ...extra })
    expect(countedFor(dm({}), [], [])).toBe(7)
    expect(countedFor(dm({ notify: 'mentions' }), [], [])).toBe(1)
    expect(countedFor(dm({ notify: 'mute' }), [], [])).toBe(0)
    expect(countedFor(buf({ unread: 9, mentions: 2 }), [], [])).toBe(2)
    expect(countedFor(buf({ unread: 9, mentions: 2, notify: 'all' }), [], [])).toBe(9)
    // Silent because of its server, whatever it was itself set to.
    expect(countedFor(dm({ notifyApplied: 'mute' }), [], [])).toBe(0)
  })

  it('counts a muted channel by its mentions, since muting is not hiding that you were asked for', () => {
    expect(countedFor(buf({ highlight: true, mentions: 2 }), ['a|#x'], [])).toBe(2)
    expect(countedFor(buf({ highlight: true, mentions: 2 }), [], [], ['g'])).toBe(2)
    expect(countedFor(buf({ highlight: true, mentions: 2, notify: 'mute' }), [], [])).toBe(2)
    // Everything else said in it is not counted whether muted or not.
    expect(countedFor(buf({ unread: 97 }), ['a|#x'], [])).toBe(0)
  })

  it('counts a muted direct message for nothing - it has no mentions, only messages', () => {
    expect(countedFor(buf({ kind: 'dm', unread: 5 }), [], [])).toBe(5)
    expect(countedFor(buf({ kind: 'dm', unread: 5 }), ['a|#x'], [])).toBe(0)
  })

  it('never counts what has no row to click through to', () => {
    expect(countedFor(buf({ highlight: true, mentions: 3 }), [], ['a|#x'])).toBe(0)
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

describe('waitingCount', () => {
  const buffer = (over: Partial<BufferEntry>): BufferEntry =>
    ({ id: 'a|#x', kind: 'channel', unread: 97, mentions: 0, highlight: false, ...over }) as BufferEntry
  it('is the mentions in a channel, not everything said in it', () => {
    expect(waitingCount(buffer({}))).toBe(0)
    expect(waitingCount(buffer({ mentions: 2, highlight: true }))).toBe(2)
  })
  it('is each unread message in a direct message, which are all for you', () => {
    expect(waitingCount(buffer({ kind: 'dm', unread: 4 }))).toBe(4)
  })
})
