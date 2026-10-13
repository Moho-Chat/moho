import { describe, expect, it } from 'vitest'
import type { Account } from '../../../shared/wire'
import type { BufferEntry } from '../state/store'
import { dmCategoryId, dmCategoryName, planDmCategories, type DmCategoryState } from './dmcategories'

const account = (id: string, service: Account['service'], displayName = ''): Account => ({ id, service, displayName }) as Account
const dm = (id: string, accountId: string): BufferEntry => ({ id, accountId, kind: 'dm', name: id }) as BufferEntry
const channel = (id: string, accountId: string): BufferEntry => ({ id, accountId, kind: 'channel', name: id }) as BufferEntry

const empty: DmCategoryState = { categories: [], assignment: {}, filed: [], made: [] }
const steam = account('steam:salastil', 'steam', 'salastil')
const discord = account('discord:1', 'discord', 'Salastil')
const kick = account('kick:me', 'kick', 'me')

describe('the heading for an account', () => {
  it('reads Protocol - Username', () => {
    expect(dmCategoryName(steam)).toBe('Steam - salastil')
    expect(dmCategoryName(discord)).toBe('Discord - Salastil')
  })

  it('falls back to the id, without its prefix, when the account has no name yet', () => {
    expect(dmCategoryName(account('matrix:@me:poa.st', 'matrix'))).toBe('Matrix - @me:poa.st')
  })
})

describe('sorting direct messages under their account', () => {
  it('makes a heading for each account that has direct messages, once', () => {
    const plan = planDmCategories([steam, discord, kick], [], empty)!
    expect(plan.categories.map((c) => c.name)).toEqual(['Steam - salastil', 'Discord - Salastil'])
    expect(plan.made).toEqual(['steam:salastil', 'discord:1'])
    expect(plan.made).not.toContain('kick:me')
  })

  it('files conversations that already exist, which is how an account added long ago gets sorted', () => {
    const plan = planDmCategories([steam, discord], [dm('a', 'steam:salastil'), dm('b', 'discord:1'), dm('c', 'steam:salastil')], empty)!
    expect(plan.assignment).toEqual({ a: dmCategoryId('steam:salastil'), b: dmCategoryId('discord:1'), c: dmCategoryId('steam:salastil') })
    expect(plan.filed.sort()).toEqual(['a', 'b', 'c'])
  })

  it('leaves channels alone', () => {
    const plan = planDmCategories([steam], [channel('#x', 'steam:salastil')], empty)!
    expect(plan.assignment).toEqual({})
    expect(plan.filed).toEqual([])
  })

  it('does nothing once everything has been done, so nothing is written', () => {
    const first = planDmCategories([steam], [dm('a', 'steam:salastil')], empty)!
    expect(planDmCategories([steam], [dm('a', 'steam:salastil')], first)).toBeNull()
  })

  it('files a new conversation when it arrives', () => {
    const first = planDmCategories([steam], [dm('a', 'steam:salastil')], empty)!
    const next = planDmCategories([steam], [dm('a', 'steam:salastil'), dm('b', 'steam:salastil')], first)!
    expect(next.assignment.b).toBe(dmCategoryId('steam:salastil'))
  })

  it('does not put back a conversation that was moved out by hand', () => {
    const first = planDmCategories([steam], [dm('a', 'steam:salastil')], empty)!
    const moved = { ...first, assignment: {} }
    expect(planDmCategories([steam], [dm('a', 'steam:salastil')], moved)).toBeNull()
  })

  it('does not overwrite a heading somebody chose for it', () => {
    const plan = planDmCategories([steam], [dm('a', 'steam:salastil')], { ...empty, assignment: { a: 'mine' } })!
    expect(plan.assignment.a).toBe('mine')
  })

  it('does not make a deleted heading again, and files nothing under it', () => {
    const first = planDmCategories([steam], [], empty)!
    const deleted = { ...first, categories: [] }
    expect(planDmCategories([steam], [], deleted)).toBeNull()
    const later = planDmCategories([steam], [dm('a', 'steam:salastil')], deleted)!
    expect(later.assignment).toEqual({})
    expect(later.filed).toEqual(['a'])
  })

  it('keeps a heading somebody renamed', () => {
    const first = planDmCategories([steam], [], empty)!
    const renamed = { ...first, categories: [{ id: dmCategoryId('steam:salastil'), name: 'Games' }] }
    expect(planDmCategories([steam], [dm('a', 'steam:salastil')], renamed)!.categories[0].name).toBe('Games')
  })

  it('removes the heading of an account that has gone, and makes it afresh if it comes back', () => {
    const first = planDmCategories([steam, discord], [], empty)!
    const gone = planDmCategories([discord], [], first)!
    expect(gone.categories.map((c) => c.id)).toEqual([dmCategoryId('discord:1')])
    expect(gone.made).toEqual(['discord:1'])
    const back = planDmCategories([steam, discord], [], gone)!
    expect(back.categories.map((c) => c.id)).toContain(dmCategoryId('steam:salastil'))
  })

  it('leaves the headings people made themselves alone', () => {
    const mine = { id: 'abc', name: 'Friends' }
    const plan = planDmCategories([steam], [], { ...empty, categories: [mine] })!
    expect(plan.categories[0]).toEqual(mine)
  })

  it('waits for accounts before saying anything, and for an account before filing its conversations', () => {
    expect(planDmCategories([], [dm('a', 'steam:salastil')], empty)).toBeNull()
    const plan = planDmCategories([discord], [dm('a', 'steam:salastil')], empty)!
    expect(plan.filed).toEqual([])
  })
})
