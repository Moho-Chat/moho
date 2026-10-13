import { describe, expect, it } from 'vitest'
import { autoCeiling, captionTrack, menuOrder, renditionLabel, renditionOf } from './streamplayer'

const ladder = [
  { height: 160, frameRate: 30, bitrate: 230000 },
  { height: 1080, frameRate: 60, bitrate: 8519450 },
  { height: 720, frameRate: 60, bitrate: 3422999 },
  { height: 480, frameRate: 30, bitrate: 1427999 },
  { height: 360, frameRate: 30, bitrate: 630000 }
]

describe('the renditions a stream offers', () => {
  it('are named as Kick names them: the height, and the frame rate where it is above thirty', () => {
    expect(renditionLabel({ height: 720, frameRate: 60 })).toBe('720p60')
    expect(renditionLabel({ height: 480, frameRate: 30 })).toBe('480p')
    expect(renditionLabel({ height: 360 })).toBe('360p')
    expect(renditionLabel({ height: 1080, frameRate: 59.94 })).toBe('1080p60')
  })

  it('are listed tallest first, with where each is in the player\'s own list, and one to a height', () => {
    expect(menuOrder(ladder).map((r) => [r.label, r.index])).toEqual([['1080p60', 1], ['720p60', 2], ['480p', 3], ['360p', 4], ['160p', 0]])
    expect(menuOrder([...ladder, { height: 720, frameRate: 30, bitrate: 1 }]).filter((r) => r.height === 720)).toHaveLength(1)
  })

  it('are found by the height somebody wants, or by nothing when it is not offered', () => {
    expect(renditionOf(ladder, 480)).toBe(3)
    expect(renditionOf(ladder, 900)).toBe(-1)
  })

  it('have a ceiling for automatic choice: the tallest that fits, the shortest when none does, none when there is no ceiling', () => {
    expect(autoCeiling(ladder, 720)).toBe(2)
    expect(autoCeiling(ladder, 1440)).toBe(1)
    expect(autoCeiling(ladder, 100)).toBe(0)
    expect(autoCeiling(ladder, 0)).toBe(-1)
    expect(autoCeiling([], 720)).toBe(-1)
  })
})

describe('the captions a stream offers', () => {
  const tracks = [{ id: 0, name: 'English', lang: 'en' }, { id: 1, name: 'Portuguese', lang: 'pt' }, { id: 2, name: 'Spanish', lang: 'es' }]

  it('are off when nothing is wanted or there is nothing to show', () => {
    expect(captionTrack(tracks, '')).toBe(-1)
    expect(captionTrack([], 'en')).toBe(-1)
  })

  it('are the language that was chosen, however it was written', () => {
    expect(captionTrack(tracks, 'pt')).toBe(1)
    expect(captionTrack(tracks, 'PT-BR')).toBe(1)
  })

  it('fall back to the person\'s own language, and then to the first, when the one chosen is not offered', () => {
    expect(captionTrack(tracks, 'ja', 'es')).toBe(2)
    expect(captionTrack(tracks, 'ja', 'xx')).toBe(0)
    expect(captionTrack(tracks, 'ja')).toBe(0)
  })
})
