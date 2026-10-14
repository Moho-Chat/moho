import { describe, expect, it } from 'vitest'
import { withPrefetch } from './ivsplaylist'

/** A rendition's playlist as Kick's stream serves one: two-second segments, six-second target, two prefetch lines. */
const playlist = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:6',
  '#EXT-X-MEDIA-SEQUENCE:2939',
  '#EXT-X-PROGRAM-DATE-TIME:2026-10-13T22:58:41.442Z',
  '#EXTINF:2.000,live',
  'https://cdn.example/v1/segment/a',
  '#EXT-X-PROGRAM-DATE-TIME:2026-10-13T22:58:43.442Z',
  '#EXTINF:2.000,live',
  'https://cdn.example/v1/segment/b',
  '#EXT-X-PREFETCH:https://cdn.example/v1/segment/c',
  '#EXT-X-PREFETCH:https://cdn.example/v1/segment/d',
  ''
].join('\n')

describe('a playlist that lists what is being made', () => {
  it('has each prefetch line become a segment as long as the last complete one, after the complete ones', () => {
    const lines = withPrefetch(playlist).split('\n').filter(Boolean)
    expect(lines.slice(-4)).toEqual(['#EXTINF:2.000,prefetch', 'https://cdn.example/v1/segment/c', '#EXTINF:2.000,prefetch', 'https://cdn.example/v1/segment/d'])
    expect(lines.some((l) => l.startsWith('#EXT-X-PREFETCH'))).toBe(false)
    expect(lines.filter((l) => l.startsWith('https://')).length).toBe(4)
  })

  it('can take only some of them, or none', () => {
    expect(withPrefetch(playlist, 1).split('\n').filter((l) => l.startsWith('https://'))).toHaveLength(3)
    expect(withPrefetch(playlist, 0)).toBe(playlist)
  })

  it('is left as it was when it has none, when it is of a stream that has ended, or when nothing is complete to measure by', () => {
    const plain = playlist.replace(/#EXT-X-PREFETCH:\S+\n/g, '')
    expect(withPrefetch(plain)).toBe(plain)
    const ended = `${playlist}#EXT-X-ENDLIST\n`
    expect(withPrefetch(ended)).toBe(ended)
    const none = ['#EXTM3U', '#EXT-X-TARGETDURATION:6', '#EXT-X-PREFETCH:https://cdn.example/v1/segment/c', ''].join('\n')
    expect(withPrefetch(none)).toBe(none)
  })

  it('keeps everything else about the playlist, in the order it had it', () => {
    const out = withPrefetch(playlist).split('\n')
    expect(out.slice(0, 5)).toEqual(playlist.split('\n').slice(0, 5))
    expect(out).toContain('#EXT-X-PROGRAM-DATE-TIME:2026-10-13T22:58:43.442Z')
  })
})

describe('withPrefetch on segments of uneven length', () => {
  it('leaves the playlist as it is when the last segment is no guide to the next', () => {
    const playlist = ['#EXTM3U', '#EXTINF:3.200,live', 'a.ts', '#EXTINF:5.166,live', 'b.ts', '#EXT-X-PREFETCH:c.ts', ''].join('\n')
    expect(withPrefetch(playlist)).toBe(playlist)
  })
})

describe('withPrefetch on a Twitch playlist', () => {
  const twitch = [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    '#EXT-X-TARGETDURATION:5',
    '#EXT-X-MEDIA-SEQUENCE:100',
    '#EXTINF:2.000,live',
    'https://cdn.example/a.mp4',
    '#EXTINF:2.000,live',
    'https://cdn.example/b.mp4',
    '#EXT-X-TWITCH-PREFETCH:https://cdn.example/c.mp4',
    '#EXT-X-TWITCH-PREFETCH:https://cdn.example/d.mp4',
    ''
  ].join('\n')

  it('reads the prefetch lines under Twitch name as segments of the same length', () => {
    const out = withPrefetch(twitch)
    expect(out).not.toContain('PREFETCH')
    expect(out.split('\n').filter((l) => l.startsWith('#EXTINF'))).toEqual(['#EXTINF:2.000,live', '#EXTINF:2.000,live', '#EXTINF:2.000,prefetch', '#EXTINF:2.000,prefetch'])
    expect(out.trim().endsWith('https://cdn.example/d.mp4')).toBe(true)
  })

  it('leaves a playlist with none - an ad is playing, and ads are not prefetched - as it is', () => {
    const ad = twitch.replace(/#EXT-X-TWITCH-PREFETCH:.*\n/g, '').replace(/live/g, 'Amazon|2474283100494')
    expect(withPrefetch(ad)).toBe(ad)
  })
})
