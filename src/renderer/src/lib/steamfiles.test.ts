import { describe, expect, it } from 'vitest'
import { STEAM_MAX_BYTES, steamFileRefusal } from './steamfiles'

describe('the files Steam takes in a chat', () => {
  it('takes the types its own client takes, by extension in any case', () => {
    for (const name of ['a.jpg', 'a.JPEG', 'a.png', 'a.gif', 'a.webm', 'a.mpg', 'a.mp4', 'a.mpeg', 'a.ogv', 'a.webp', 'a.avif']) {
      expect(steamFileRefusal(name, 10), name).toBeNull()
    }
  })
  it('refuses the rest in words that name what it does take', () => {
    expect(steamFileRefusal('paper.pdf', 10)).toContain('.pdf')
    expect(steamFileRefusal('paper.pdf', 10)).toContain('webm')
    expect(steamFileRefusal('noextension')).toContain('that kind of')
  })
  it('refuses a file over thirty megabytes, and an empty one', () => {
    expect(steamFileRefusal('a.png', STEAM_MAX_BYTES)).toBeNull()
    expect(steamFileRefusal('a.png', STEAM_MAX_BYTES + 1)).toContain('30 MB')
    expect(steamFileRefusal('a.png', 0)).toContain('empty')
  })
})
