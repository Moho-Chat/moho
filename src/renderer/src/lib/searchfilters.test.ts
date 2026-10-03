import { describe, expect, it } from 'vitest'
import { hasQuery, parseSearch, suggestions } from './searchfilters'

describe('search filters', () => {
  it('takes known filters out and leaves the words', () => {
    const parsed = parseSearch('cats from:salastil in:"general chat" has:file meow')
    expect(parsed.text).toBe('cats meow')
    expect(parsed.from).toBe('salastil')
    expect(parsed.in).toBe('general chat')
    expect(parsed.has).toBe('file')
  })

  it('reads dates, and keeps a malformed one as text', () => {
    const parsed = parseSearch('before:2026-01-31 after:last-week')
    expect(parsed.before).toBe(Math.floor(Date.parse('2026-01-31T00:00:00') / 1000))
    expect(parsed.after).toBeUndefined()
    expect(parsed.text).toBe('after:last-week')
  })

  it('notes a word: that is not a filter, and keeps it in the text', () => {
    const parsed = parseSearch('http://x.com subject:hi')
    expect(parsed.unknown).toEqual(['http', 'subject'])
    expect(parsed.text).toBe('http://x.com subject:hi')
  })

  it('knows when there is nothing to search for', () => {
    expect(hasQuery(parseSearch('   '))).toBe(false)
    expect(hasQuery(parseSearch('from:'))).toBe(false)
    expect(hasQuery(parseSearch('from:x'))).toBe(true)
  })

  it('suggests filters for a partial word, and none inside one', () => {
    expect(suggestions('cats f').map((f) => f.key)).toEqual(['from'])
    expect(suggestions('').length).toBe(6)
    expect(suggestions('from:')).toEqual([])
  })
})
