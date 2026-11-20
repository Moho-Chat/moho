import { describe, expect, it } from 'vitest'
import { isLocalIrcId, reactionLabel, reactorsSentence, sneedchatReactionOf } from './reactions'

describe('reactionLabel', () => {
  it('names a custom emoji from its own token, animated or not', () => {
    expect(reactionLabel('<:pepe_sad:12345>')).toBe(':pepe_sad:')
    expect(reactionLabel('<a:party_parrot:999>')).toBe(':party_parrot:')
  })
  it('names a Stoat emoji from its picture token', () => {
    expect(reactionLabel('[stoat:emoji:party:file:///home/me/.cache/nobilis/stoat-media/abc.png]')).toBe(':party:')
  })
  it('reads a Windows path in a picture token, backslashes and all', () => {
    expect(reactionLabel('[stoat:emoji:party:file://C:\\Users\\me\\AppData\\Local\\nobilis\\stoat-media\\abc.png]')).toBe(':party:')
    const sneed = '[sneedchat:reaction:reaction_39:Christian Content:file://C:\\Users\\me\\AppData\\Local\\nobilis\\sneedchat-avatars\\reaction-reaction_39.png#1795154362]'
    expect(sneedchatReactionOf(sneed)).toEqual({
      code: 'reaction_39',
      title: 'Christian Content',
      path: 'file://C:\\Users\\me\\AppData\\Local\\nobilis\\sneedchat-avatars\\reaction-reaction_39.png#1795154362'
    })
    expect(reactionLabel(sneed)).toBe('Christian Content')
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

describe('isLocalIrcId', () => {
  it('knows the ids the daemon made up from the ones a server gave', () => {
    expect(isLocalIrcId('1731940000.12')).toBe(true)
    expect(isLocalIrcId('01HZX3K9ABCDEF')).toBe(false)
    expect(isLocalIrcId('abc.def')).toBe(false)
  })
})

describe("Kiwi Farms' reactions", () => {
  const held = '[sneedchat:reaction:reaction_2:Agree:file:///home/u/.cache/nobilis/sneedchat-avatars/reaction-reaction_2.png#1795]'

  it('are read back with their name and cached picture', () => {
    expect(sneedchatReactionOf(held)).toEqual({
      code: 'reaction_2',
      title: 'Agree',
      path: 'file:///home/u/.cache/nobilis/sneedchat-avatars/reaction-reaction_2.png#1795'
    })
    expect(reactionLabel(held)).toBe('Agree')
  })

  it('are named by code while their picture is not yet fetched', () => {
    expect(sneedchatReactionOf('[sneedchat:reaction:reaction_9::]')).toEqual({ code: 'reaction_9', title: '', path: '' })
    expect(reactionLabel('[sneedchat:reaction:reaction_9::]')).toBe('reaction_9')
  })

  it('never take a picture from outside the cache', () => {
    expect(sneedchatReactionOf('[sneedchat:reaction:reaction_2:Agree:file:///etc/passwd]')).toBeNull()
    expect(sneedchatReactionOf('[sneedchat:reaction:reaction_2:Agree:https://evil.example/a.png]')).toBeNull()
  })
})
