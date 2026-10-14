import { describe, expect, it } from 'vitest'
import { isPlainEmoji, recentsHere } from './recents'

describe('recent emoji', () => {
  const picks = ['👍', '<:pepe:123>', '[emote:99:KEKW]', '[twitch:emote:25:Kappa]', ':lol:', '😂']

  it('are told apart from the stand-ins for somebody\'s own emoji', () => {
    expect(picks.map(isPlainEmoji)).toEqual([true, false, false, false, false, true])
  })

  it('offer only what the open conversation can send, and the ordinary emoji everywhere', () => {
    const here = new Set(['[emote:99:KEKW]', '[twitch:emote:25:Kappa]'])
    expect(recentsHere(picks, here, true, false)).toEqual(['👍', '[emote:99:KEKW]', '[twitch:emote:25:Kappa]', '😂'])
    // A Discord emoji from another server, a lapsed unlock, a smilie of another service: not offered.
    expect(recentsHere(picks, new Set(), true, false)).toEqual(['👍', '😂'])
  })

  it('wait for the daemon before offering anything that is not an ordinary emoji', () => {
    expect(recentsHere(picks, new Set(picks), false, false)).toEqual(['👍', '😂'])
  })

  it('leave out ordinary emoji where the service takes only its own set', () => {
    const steam = new Set(['[steam:emote:steambored]'])
    expect(recentsHere(['👍', '[steam:emote:steambored]', '[steam:emote:gone]'], steam, true, true)).toEqual(['[steam:emote:steambored]'])
  })
})
