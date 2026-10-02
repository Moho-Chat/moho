import { describe, expect, it } from 'vitest'
import { fuzzyScore, mentionInsert, mentionKeywords, mentionQuery, rankMentions } from './mentions'

describe('mentions', () => {
  it('reads what is being typed after an @', () => {
    expect(mentionQuery('hello @sal')).toBe('sal')
    expect(mentionQuery('(@')).toBe('')
    expect(mentionQuery('mail@example')).toBeNull()
    expect(mentionQuery('no mention')).toBeNull()
  })

  it('inserts what each service understands', () => {
    expect(mentionInsert('irc', 'nick', true)).toBe('nick: ')
    expect(mentionInsert('irc', 'nick', false)).toBe('nick ')
    expect(mentionInsert('discord', 'nick', true)).toBe('@nick ')
  })

  it('offers each service its own room-wide words', () => {
    expect(mentionKeywords('discord').map((k) => k.word)).toEqual(['everyone', 'here'])
    expect(mentionKeywords('matrix').map((k) => k.word)).toEqual(['room'])
    expect(mentionKeywords('irc')).toEqual([])
  })

  it('ranks a prefix over a word start over scattered letters', () => {
    expect(fuzzyScore('salastil', 'sal')).toBeGreaterThan(fuzzyScore('big_sal', 'sal'))
    expect(fuzzyScore('big_sal', 'sal')).toBeGreaterThan(fuzzyScore('sxaxl', 'sal'))
    expect(fuzzyScore('bob', 'sal')).toBe(0)
  })

  it('drops what does not match, best first, up to the limit', () => {
    const targets = ['salastil', 'big_sal', 'bob', 's_a_l'].map((name) => ({ name, kind: 'member' as const }))
    expect(rankMentions(targets, 'sal', 2).map((t) => t.name)).toEqual(['salastil', 'big_sal'])
  })
})
