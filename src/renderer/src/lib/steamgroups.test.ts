import { describe, expect, it } from 'vitest'
import type { Account } from '../../../shared/wire'
import type { BufferEntry } from '../state/store'
import { dmCategoryId } from './dmcategories'
import { folderName, headingName, parseSteamCategory, seedSteamFolders, steamCategoryId, type SteamGroup } from './steamgroups'

const account = { id: 'steam:me', service: 'steam', displayName: 'me' } as Account
const dm = (name: string, remoteId: string): BufferEntry => ({ id: `steam:me|${name}`, accountId: 'steam:me', kind: 'dm', name, remoteId }) as BufferEntry
const GABE = '76561197960265729'
const ALYX = '76561197960287930'
const heading = dmCategoryId('steam:me')

type Current = { categories: { id: string; name: string }[]; assignment: Record<string, string>; seeded: string[] }
const start = (over: Partial<Current> = {}): Current => ({ categories: [{ id: heading, name: 'Steam - me' }], assignment: {}, seeded: [], ...over })
const groups = (list: SteamGroup[]): Record<string, SteamGroup[]> => ({ 'steam:me': list })
const buffers = [dm('Gabe', GABE), dm('Alyx', ALYX)]
const filed = { 'steam:me|Gabe': heading, 'steam:me|Alyx': heading }

describe('a Steam folder is named for its id and read back from it', () => {
  it('has a stable heading id', () => {
    expect(steamCategoryId('steam:me', 7)).toBe('sg:steam:me:7')
    expect(parseSteamCategory('sg:steam:me:7')).toEqual({ accountId: 'steam:me', groupId: 7 })
    expect(parseSteamCategory(heading)).toBeNull()
    expect(parseSteamCategory('sg:nonsense')).toBeNull()
  })

  it('is shown without the "Steam - " some of them carry, and a heading from it is called protocol, then folder', () => {
    expect(folderName('Steam - Goons')).toBe('Goons')
    expect(folderName('Friends')).toBe('Friends')
    expect(headingName(account, { id: 1, name: 'Steam - Goons', members: [] })).toBe('Steam - Goons')
    expect(headingName(account, { id: 3, name: 'Friends', members: [] })).toBe('Steam - Friends')
  })
})

describe('the direct-messages page starts from an account\'s folders, once', () => {
  it('makes a heading for each, with their friends under it, the first time they are heard', () => {
    const plan = seedSteamFolders([account], buffers, groups([{ id: 7, name: 'Steam - Raiders', members: [GABE] }]), start({ assignment: filed }))!
    expect(plan.categories.find((c) => c.id === 'sg:steam:me:7')?.name).toBe('Steam - Raiders')
    expect(plan.assignment['steam:me|Gabe']).toBe('sg:steam:me:7')
    expect(plan.assignment['steam:me|Alyx']).toBe(heading)
    expect(plan.seeded).toEqual(['steam:me'])
  })

  it('leaves a conversation a person has put somewhere themselves where it is', () => {
    const plan = seedSteamFolders([account], buffers, groups([{ id: 7, name: 'Raiders', members: [GABE] }]), start({ assignment: { ...filed, 'steam:me|Gabe': 'cat-mine' } }))!
    expect(plan.assignment['steam:me|Gabe']).toBe('cat-mine')
  })

  it('does nothing before Steam has spoken, and nothing for an account with no folders but marks it', () => {
    expect(seedSteamFolders([account], buffers, {}, start())).toBeNull()
    const none = seedSteamFolders([account], buffers, groups([]), start())!
    expect(none.categories).toEqual(start().categories)
    expect(none.seeded).toEqual(['steam:me'])
  })

  it('never does it again: a folder made on Steam later is not made here, and one deleted here is not made again', () => {
    const first = seedSteamFolders([account], buffers, groups([{ id: 7, name: 'Raiders', members: [GABE] }]), start({ assignment: filed }))!
    const later = groups([{ id: 7, name: 'Raiders', members: [GABE] }, { id: 8, name: 'Work', members: [ALYX] }])
    expect(seedSteamFolders([account], buffers, later, { categories: first.categories, assignment: first.assignment, seeded: first.seeded })).toBeNull()
    const deleted = first.categories.filter((c) => c.id !== 'sg:steam:me:7')
    expect(seedSteamFolders([account], buffers, later, { categories: deleted, assignment: first.assignment, seeded: first.seeded })).toBeNull()
  })

  it('follows nothing: a rename or a move on Steam does not reach the page', () => {
    const first = seedSteamFolders([account], buffers, groups([{ id: 7, name: 'Raiders', members: [GABE] }]), start({ assignment: filed }))!
    const moved = groups([{ id: 7, name: 'Renamed', members: [ALYX] }])
    expect(seedSteamFolders([account], buffers, moved, { categories: first.categories, assignment: first.assignment, seeded: first.seeded })).toBeNull()
  })

  it('only marks an account whose page already has headings from its folders, and leaves them as they are', () => {
    const had = [{ id: heading, name: 'Steam - me' }, { id: 'sg:steam:me:7', name: 'Steam - Raiders' }, { id: 'sg:steam:me:8', name: 'Mine now' }]
    const plan = seedSteamFolders([account], buffers, groups([{ id: 7, name: 'Steam - Raiders', members: [GABE] }]), { categories: had, assignment: { 'steam:me|Gabe': 'sg:steam:me:7' }, seeded: [] })!
    expect(plan.categories.map((c) => c.name)).toEqual(['Steam - me', 'Steam - Raiders', 'Mine now'])
    expect(plan.assignment['steam:me|Gabe']).toBe('sg:steam:me:7')
    expect(plan.seeded).toEqual(['steam:me'])
  })
})
