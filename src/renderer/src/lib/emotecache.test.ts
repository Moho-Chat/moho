import { afterEach, describe, expect, it } from 'vitest'
import { drawableEmoteUrl, kickEmoteId, resetLocalEmotes } from './emotecache'

afterEach(resetLocalEmotes)

describe('Kick emote cache', () => {
  it('reads the id out of Kick fullsize URLs only', () => {
    expect(kickEmoteId('https://files.kick.com/emotes/39261/fullsize')).toBe('39261')
    expect(kickEmoteId('https://files.kick.com/emotes/39261/small')).toBeNull()
    expect(kickEmoteId('https://cdn.7tv.app/emote/x/1x.webp')).toBeNull()
  })

  it("draws Kick's own picture until there is a local copy, and anything else as it is", () => {
    const kick = 'https://files.kick.com/emotes/1/fullsize'
    expect(drawableEmoteUrl(kick)).toBe(kick)
    expect(drawableEmoteUrl('https://example.com/e.png')).toBe('https://example.com/e.png')
  })
})
