import { describe, expect, it } from 'vitest'
import type { Account } from '../../../shared/wire'
import type { BufferEntry } from '../state/store'
import { dmCategoryId } from './dmcategories'
import { parseSteamCategory, planSteamGroups, steamCategoryId, type SteamGroup, type SteamSyncState } from './steamgroups'

const account = { id: 'steam:me', service: 'steam', displayName: 'me' } as Account
const dm = (name: string, remoteId: string): BufferEntry => ({ id: `steam:me|${name}`, accountId: 'steam:me', kind: 'dm', name, remoteId }) as BufferEntry
const GABE = '76561197960265729'
const ALYX = '76561197960287930'
const heading = dmCategoryId('steam:me')
const empty: SteamSyncState = { applied: {}, names: {} }

type Current = { categories: { id: string; name: string }[]; assignment: Record<string, string>; state: SteamSyncState }
const start = (over: Partial<Current> = {}): Current => ({ categories: [{ id: heading, name: 'Steam - me' }], assignment: {}, state: empty, ...over })
const groups = (list: SteamGroup[]): Record<string, SteamGroup[]> => ({ 'steam:me': list })

describe('a Steam group is a heading', () => {
  it('is named for the id and read back from it', () => {
    expect(steamCategoryId('steam:me', 7)).toBe('sg:steam:me:7')
    expect(parseSteamCategory('sg:steam:me:7')).toEqual({ accountId: 'steam:me', groupId: 7 })
    expect(parseSteamCategory(heading)).toBeNull()
    expect(parseSteamCategory('sg:nonsense')).toBeNull()
  })

  it('appears, with its friends under it, the first time Steam says so', () => {
    const buffers = [dm('Gabe', GABE), dm('Alyx', ALYX)]
    const plan = planSteamGroups([account], buffers, groups([{ id: 7, name: 'Raiders', members: [GABE] }]), start({ assignment: { 'steam:me|Gabe': heading, 'steam:me|Alyx': heading } }))!
    expect(plan.categories.find((c) => c.id === 'sg:steam:me:7')?.name).toBe('Raiders')
    expect(plan.assignment['steam:me|Gabe']).toBe('sg:steam:me:7')
    expect(plan.assignment['steam:me|Alyx']).toBe(heading)
    expect(plan.calls).toEqual([])
  })

  it('says nothing when nothing has changed, and nothing before Steam has spoken', () => {
    const buffers = [dm('Gabe', GABE)]
    const first = planSteamGroups([account], buffers, groups([{ id: 7, name: 'Raiders', members: [GABE] }]), start({ assignment: { 'steam:me|Gabe': heading } }))!
    const again = planSteamGroups([account], buffers, groups([{ id: 7, name: 'Raiders', members: [GABE] }]), { categories: first.categories, assignment: first.assignment, state: first.state })
    expect(again).toBeNull()
    expect(planSteamGroups([account], buffers, {}, start())).toBeNull()
  })
})

describe('what is done here is done on Steam', () => {
  const settled = (): Current => {
    const buffers = [dm('Gabe', GABE), dm('Alyx', ALYX)]
    const p = planSteamGroups([account], buffers, groups([{ id: 7, name: 'Raiders', members: [GABE] }, { id: 8, name: 'Work', members: [] }]), start({ assignment: { 'steam:me|Gabe': heading, 'steam:me|Alyx': heading } }))!
    return { categories: p.categories, assignment: p.assignment, state: p.state }
  }
  const buffers = [dm('Gabe', GABE), dm('Alyx', ALYX)]
  const world = groups([{ id: 7, name: 'Raiders', members: [GABE] }, { id: 8, name: 'Work', members: [] }])

  it('puts a friend into a group when their conversation is dragged under its heading', () => {
    const now = settled()
    now.assignment['steam:me|Alyx'] = 'sg:steam:me:7'
    const plan = planSteamGroups([account], buffers, world, now)!
    expect(plan.calls).toEqual([{ accountId: 'steam:me', action: 'add', groupId: 7, steamid: ALYX }])
    expect(plan.assignment['steam:me|Alyx']).toBe('sg:steam:me:7')
  })

  it('takes them out when it is dragged away, and moves them between groups as one change', () => {
    const now = settled()
    now.assignment['steam:me|Gabe'] = heading
    expect(planSteamGroups([account], buffers, world, now)!.calls).toEqual([{ accountId: 'steam:me', action: 'remove', groupId: 7, steamid: GABE }])
    const moved = settled()
    moved.assignment['steam:me|Gabe'] = 'sg:steam:me:8'
    expect(planSteamGroups([account], buffers, world, moved)!.calls).toEqual([
      { accountId: 'steam:me', action: 'remove', groupId: 7, steamid: GABE },
      { accountId: 'steam:me', action: 'add', groupId: 8, steamid: GABE }
    ])
  })

  it('renames and deletes the group when its heading is renamed or deleted', () => {
    const renamed = settled()
    renamed.categories = renamed.categories.map((c) => (c.id === 'sg:steam:me:7' ? { ...c, name: 'Raid Team' } : c))
    const plan = planSteamGroups([account], buffers, world, renamed)!
    expect(plan.calls).toEqual([{ accountId: 'steam:me', action: 'rename', groupId: 7, name: 'Raid Team' }])
    expect(plan.state.names['sg:steam:me:7']).toBe('Raid Team')
    const deleted = settled()
    deleted.categories = deleted.categories.filter((c) => c.id !== 'sg:steam:me:8')
    const gone = planSteamGroups([account], buffers, world, deleted)!
    expect(gone.calls).toEqual([{ accountId: 'steam:me', action: 'delete', groupId: 8 }])
    expect('sg:steam:me:8' in gone.state.names).toBe(false)
  })

  it('leaves a conversation the person put under a heading of their own alone', () => {
    const now = settled()
    now.categories = [...now.categories, { id: 'games', name: 'Games' }]
    now.assignment['steam:me|Alyx'] = 'games'
    const plan = planSteamGroups([account], buffers, groups([{ id: 7, name: 'Raiders', members: [GABE, ALYX] }, { id: 8, name: 'Work', members: [] }]), now)
    expect(plan?.assignment?.['steam:me|Alyx'] ?? 'games').toBe('games')
    expect(plan?.calls ?? []).toEqual([])
  })
})

describe('what is done on Steam is done here', () => {
  const buffers = [dm('Gabe', GABE), dm('Alyx', ALYX)]
  const settled = (list: SteamGroup[]): Current => {
    const p = planSteamGroups([account], buffers, groups(list), start({ assignment: { 'steam:me|Gabe': heading, 'steam:me|Alyx': heading } }))!
    return { categories: p.categories, assignment: p.assignment, state: p.state }
  }

  it('moves a conversation when its friend is put into or taken out of a group', () => {
    const now = settled([{ id: 7, name: 'Raiders', members: [GABE] }])
    const joined = planSteamGroups([account], buffers, groups([{ id: 7, name: 'Raiders', members: [GABE, ALYX] }]), now)!
    expect(joined.assignment['steam:me|Alyx']).toBe('sg:steam:me:7')
    expect(joined.calls).toEqual([])
    const left = planSteamGroups([account], buffers, groups([{ id: 7, name: 'Raiders', members: [] }]), now)!
    expect(left.assignment['steam:me|Gabe']).toBe(heading)
    expect(left.calls).toEqual([])
  })

  it('follows a rename and a deletion, and puts the conversations back under the account', () => {
    const now = settled([{ id: 7, name: 'Raiders', members: [GABE] }])
    const renamed = planSteamGroups([account], buffers, groups([{ id: 7, name: 'Raid Team', members: [GABE] }]), now)!
    expect(renamed.categories.find((c) => c.id === 'sg:steam:me:7')?.name).toBe('Raid Team')
    expect(renamed.calls).toEqual([])
    const deleted = planSteamGroups([account], buffers, groups([]), now)!
    expect(deleted.categories.some((c) => c.id === 'sg:steam:me:7')).toBe(false)
    expect(deleted.assignment['steam:me|Gabe']).toBe(heading)
    expect(deleted.calls).toEqual([])
  })
})
