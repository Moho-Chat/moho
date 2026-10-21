import { describe, expect, it } from 'vitest'
import { SEARCH_ENGINES, cleanQuery, engineName, searchUrl, shortened, validTemplate } from './searchengines'

describe('where a search goes', () => {
  it('encodes the selection into the engine the person chose', () => {
    expect(searchUrl('hello world & more', 'google')).toBe('https://www.google.com/search?q=hello%20world%20%26%20more')
    expect(searchUrl('café', 'duckduckgo')).toBe('https://duckduckgo.com/?q=caf%C3%A9')
    expect(searchUrl('x', 'yandex')).toBe('https://yandex.com/search/?text=x')
  })

  it('falls back to the first engine for one it does not know', () => {
    expect(searchUrl('x', 'nonsense')).toBe(searchUrl('x', SEARCH_ENGINES[0].id))
  })

  it('has every engine ask for the query once', () => {
    for (const e of SEARCH_ENGINES.filter((e) => e.id !== 'custom')) {
      expect(e.template.split('%s')).toHaveLength(2)
      expect(e.template.startsWith('https://')).toBe(true)
    }
  })

  it('searches nothing for nothing', () => {
    expect(searchUrl('   \n ', 'google')).toBeNull()
  })

  it('keeps a replacement pattern in the query as the text it is', () => {
    expect(searchUrl('$& $1', 'google')).toBe('https://www.google.com/search?q=%24%26%20%241')
  })
})

describe('the query', () => {
  it('is one line, trimmed', () => {
    expect(cleanQuery('  two\n\nlines\there ')).toBe('two lines here')
  })

  it('is cut short rather than sent whole', () => {
    expect(cleanQuery('a'.repeat(1000)).length).toBe(300)
  })

  it('is shortened for a menu entry', () => {
    expect(shortened('short')).toBe('short')
    expect(shortened('a very long selected sentence that goes on and on')).toMatch(/^a very long.*…$/)
    expect(shortened('a very long selected sentence that goes on and on').length).toBeLessThanOrEqual(28)
  })
})

describe('an engine of the person’s own', () => {
  it('needs a web address with a place for the query', () => {
    expect(validTemplate('https://example.org/s?q=%s')).toBe(true)
    expect(validTemplate('http://example.org/%s')).toBe(true)
    expect(validTemplate('https://example.org/s')).toBe(false)
    expect(validTemplate('javascript:alert(%s)')).toBe(false)
    expect(validTemplate('file:///etc/passwd?%s')).toBe(false)
    expect(validTemplate('')).toBe(false)
  })

  it('is used when valid and refuses to send anywhere when not', () => {
    expect(searchUrl('a b', 'custom', 'https://example.org/s?q=%s')).toBe('https://example.org/s?q=a%20b')
    expect(searchUrl('a b', 'custom', 'not a url')).toBeNull()
    expect(searchUrl('a b', 'custom')).toBeNull()
  })

  it('is named by its host', () => {
    expect(engineName('custom', 'https://www.example.org/s?q=%s')).toBe('example.org')
    expect(engineName('custom', 'garbage')).toBe('the web')
    expect(engineName('google', '')).toBe('Google')
  })
})
