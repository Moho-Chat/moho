import { describe, expect, it } from 'vitest'
import { fuzzyFilter } from './fuzzy'

const people = [
  { name: 'Gaunt King', user: 'gk_1987' },
  { name: 'Clarence', user: 'clarence.b' },
  { name: 'King Clarion', user: 'kc' },
  { name: 'Wren', user: 'wrenling' }
]
const find = (q: string): string[] => fuzzyFilter(people, q, (p) => [p.name, p.user]).map((p) => p.name)

describe('fuzzyFilter', () => {
  it('gives everything back, in order, with nothing typed', () => {
    expect(find('  ')).toEqual(people.map((p) => p.name))
  })
  it('puts a name that starts with it before one that only contains it', () => {
    expect(find('king')).toEqual(['King Clarion', 'Gaunt King'])
  })
  it('finds letters in order, which is the fuzzy part', () => {
    expect(find('gnk')).toEqual(['Gaunt King'])
    expect(find('wrn')).toEqual(['Wren'])
  })
  it('finds somebody by their username too, after those found by name', () => {
    expect(find('kc')).toEqual(['King Clarion'])
    expect(find('clar')).toEqual(['Clarence', 'King Clarion'])
  })
  it('wants every word typed to match', () => {
    expect(find('king cl')).toEqual(['King Clarion'])
    expect(find('king zz')).toEqual([])
  })
})
