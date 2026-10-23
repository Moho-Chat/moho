import { describe, expect, it } from 'vitest'
import {
  folderAssignment,
  folderCategories,
  folderOrder,
  isPendingCategory,
  parseTelegramCategory,
  pendingCategoryId,
  telegramCategoryId
} from './telegramfolders'

const folders = [
  { id: 3, name: 'Work', members: ['100', '101'] },
  { id: 2, name: 'Bots', members: ['101', '200'] }
]

describe('a Telegram folder as a category', () => {
  it('is named by its account and folder, and read back', () => {
    const id = telegramCategoryId('telegram:12345', 3)
    expect(id).toBe('tf:telegram:12345:3')
    expect(parseTelegramCategory(id)).toEqual({ accountId: 'telegram:12345', folderId: 3 })
    expect(parseTelegramCategory('sg:steam:1:2')).toBeNull()
    expect(parseTelegramCategory('tf:nonsense')).toBeNull()
  })

  it('keeps Telegram’s order and names', () => {
    expect(folderCategories('telegram:1', folders)).toEqual([
      { id: 'tf:telegram:1:3', name: 'Work' },
      { id: 'tf:telegram:1:2', name: 'Bots' }
    ])
  })

  it('draws a conversation under the first folder that holds it', () => {
    const got = folderAssignment('telegram:1', folders, [
      { id: 'a', remoteId: '100' },
      { id: 'b', remoteId: '101' },
      { id: 'c', remoteId: '200' },
      { id: 'd', remoteId: '999' },
      { id: 'e', remoteId: null }
    ])
    expect(got).toEqual({ a: 'tf:telegram:1:3', b: 'tf:telegram:1:3', c: 'tf:telegram:1:2' })
  })

  it('turns the categories’ order into the folders’ numbers, leaving out what is not a folder', () => {
    expect(folderOrder(['tf:telegram:1:2', 'svc:Groups', 'tfnew:telegram:1:x', 'tf:telegram:1:3'])).toEqual([2, 3])
  })

  it('knows a category that is not a folder yet', () => {
    const id = pendingCategoryId('telegram:1')
    expect(isPendingCategory(id)).toBe(true)
    expect(parseTelegramCategory(id)).toBeNull()
    expect(isPendingCategory('tf:telegram:1:2')).toBe(false)
  })
})
