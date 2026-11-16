import { describe, expect, it } from 'vitest'
import { clockLength, fileKind, fileKindIcon } from './filekind'

describe('fileKind', () => {
  it('knows a video from a picture from everything else', () => {
    expect(fileKind('clip.MP4')).toBe('video')
    expect(fileKind('shot.jpeg')).toBe('image')
    expect(fileKind('talk.opus')).toBe('audio')
    expect(fileKind('paper.pdf')).toBe('pdf')
    expect(fileKind('src.tar.gz')).toBe('archive')
    expect(fileKind('main.rs')).toBe('code')
    expect(fileKind('notes.txt')).toBe('text')
    expect(fileKind('no-ending')).toBe('file')
  })
  it('has a glyph for each', () => {
    expect(fileKindIcon('video')).toBe('movie')
    expect(fileKindIcon('file')).toBe('draft')
  })
})

describe('clockLength', () => {
  it('reads as a clock', () => {
    expect(clockLength(7)).toBe('0:07')
    expect(clockLength(221)).toBe('3:41')
    expect(clockLength(3729)).toBe('1:02:09')
  })
})
