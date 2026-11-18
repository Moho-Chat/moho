import { describe, expect, it } from 'vitest'
import { RESTORABLE } from './mediarestore'

describe('the caches a missing picture is fetched again from', () => {
  // Every cache nobilis's media_cache::restore can fetch again; one missing here leaves a picture that is not on disk
  // yet as a broken box, though the daemon would have brought it back.
  it.each(['matrix-media', 'telegram-media', 'stoat-media', 'stoat-avatars', 'xmpp-media', 'xmpp-avatars', 'signal-media', 'signal-avatars'])('%s', (dir) => {
    expect(RESTORABLE.test(`/home/u/.cache/nobilis/${dir}/0a1b2c.jpg`)).toBe(true)
  })

  it('not a file outside the caches', () => {
    expect(RESTORABLE.test('/home/u/Pictures/cat.jpg')).toBe(false)
  })
})
