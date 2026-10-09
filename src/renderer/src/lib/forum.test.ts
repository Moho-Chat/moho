import { describe, expect, it } from 'vitest'
import { filterPosts, postAge, type ForumPost } from './forum'

const NOW = Date.UTC(2026, 9, 8) // ms
const ago = (secs: number): number => Math.floor(NOW / 1000) - secs

describe('postAge', () => {
  it('counts minutes, hours and days, and stops counting past a month', () => {
    expect(postAge(ago(10), NOW)).toBe('just now')
    expect(postAge(ago(5 * 60), NOW)).toBe('5m ago')
    expect(postAge(ago(3 * 3600), NOW)).toBe('3h ago')
    expect(postAge(ago(8 * 86400), NOW)).toBe('8d ago')
    expect(postAge(ago(45 * 86400), NOW)).toBe('>30d ago')
  })
})

const post = (id: string, name: string, extra: Partial<ForumPost> = {}): ForumPost => ({
  id, name, author: 'someone', content: '', createdTs: 0, lastTs: 0, messageCount: 0, archived: false, pinned: false, tags: [], ...extra
})

describe('filterPosts', () => {
  const posts = [post('1', 'n64 test suite', { content: 'github.com/x' }), post('2', 'Recompilator', { tags: [{ name: 'Tools' }] }), post('3', 'Rules', { pinned: true })]
  it('keeps what holds every word typed, in the title, the words or the tags', () => {
    expect(filterPosts(posts, 'n64 github').map((p) => p.id)).toEqual(['1'])
    expect(filterPosts(posts, 'tools').map((p) => p.id)).toEqual(['2'])
  })
  it('keeps pinned posts first', () => {
    expect(filterPosts(posts, '').map((p) => p.id)).toEqual(['3', '1', '2'])
  })
})
