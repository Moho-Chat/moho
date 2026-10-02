import { describe, expect, it } from 'vitest'
import { completeNick, cyclePrefix } from './completion'

describe('nick completion', () => {
  const nicks = ['Salastil', 'sally', 'bob']

  it('completes at the start of a line with a colon, and mid-line without', () => {
    expect(completeNick('sa', nicks, 0)).toEqual({ replace: 2, insert: 'Salastil: ', nick: 'Salastil' })
    expect(completeNick('hi sa', nicks, 0)).toEqual({ replace: 2, insert: 'Salastil ', nick: 'Salastil' })
  })

  it('cycles through the matches on each press', () => {
    expect(completeNick('sa', nicks, 1)?.nick).toBe('sally')
    expect(completeNick('sa', nicks, 2)?.nick).toBe('Salastil')
  })

  it('has nothing to say with no word or no match', () => {
    expect(completeNick('hi ', nicks, 0)).toBeNull()
    expect(completeNick('zz', nicks, 0)).toBeNull()
  })

  it('takes the last completion back off before cycling to the next', () => {
    const first = completeNick('sa', nicks, 0)
    expect(cyclePrefix('Salastil: ', first)).toBe('')
    expect(cyclePrefix('something else', first)).toBeNull()
    expect(cyclePrefix('x', null)).toBeNull()
  })
})
