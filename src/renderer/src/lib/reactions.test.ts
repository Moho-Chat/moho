import { describe, expect, it } from 'vitest'
import { reactionLabel, reactorsSentence } from './reactions'

describe('reactionLabel', () => {
  it('names a custom emoji from its own token, animated or not', () => {
    expect(reactionLabel('<:pepe_sad:12345>')).toBe(':pepe_sad:')
    expect(reactionLabel('<a:party_parrot:999>')).toBe(':party_parrot:')
  })
  it('looks a Unicode one up, and shows it as itself when there is no name', () => {
    const names = new Map([['🔥', 'fire']])
    expect(reactionLabel('🔥', names)).toBe(':fire:')
    expect(reactionLabel('🦦', names)).toBe('🦦')
  })
})

describe('reactorsSentence', () => {
  it('names one, two and three people the way they are said', () => {
    expect(reactorsSentence(':fire:', ['Ann'], 1)).toBe('Ann reacted with :fire:')
    expect(reactorsSentence(':fire:', ['Ann', 'Bob'], 2)).toBe('Ann and Bob reacted with :fire:')
    expect(reactorsSentence(':fire:', ['Ann', 'Bob', 'Cat'], 3)).toBe('Ann, Bob and Cat reacted with :fire:')
  })
  it('says how many more when it was not given everybody', () => {
    expect(reactorsSentence(':fire:', ['Ann', 'Bob', 'Cat', 'Dan'], 7)).toBe('Ann, Bob, Cat and 4 others reacted with :fire:')
    expect(reactorsSentence(':fire:', ['Ann', 'Bob'], 3)).toBe('Ann, Bob and 1 other reacted with :fire:')
  })
  it('says only how many when nobody is named', () => {
    expect(reactorsSentence(':fire:', [], 1)).toBe('1 person reacted with :fire:')
    expect(reactorsSentence(':fire:', [], 5)).toBe('5 people reacted with :fire:')
  })
})
