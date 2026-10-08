import { describe, expect, it } from 'vitest'
import {
  bufferDisplayName,
  classes,
  fileNameOf,
  formatRelativeTime,
  formatRelativeShort,
  dayLabel,
  dayOf,
  startsNewDay,
  guildOf,
  humanBytes,
  isChatKind,
  isImageFile,
  resolveMediaUrl
} from './util'

describe('buffer names', () => {
  it('splits a Discord channel from its guild, and leaves everything else alone', () => {
    expect(bufferDisplayName('My Guild/#general')).toBe('#general')
    expect(guildOf('My Guild/#general')).toBe('My Guild')
    expect(bufferDisplayName('#irc-channel')).toBe('#irc-channel')
    expect(guildOf('#irc-channel')).toBe('')
  })
})

describe('resolveMediaUrl', () => {
  const decoded = (url: string): string | null => new URL(url).searchParams.get('p')

  it('routes local files through the media scheme, path as a parameter', () => {
    const url = resolveMediaUrl('file:///home/a/.cache/nobilis/x%20y.png')
    expect(url.startsWith('moho-media://file/?p=')).toBe(true)
    expect(decoded(url)).toBe('/home/a/.cache/nobilis/x y.png')
    expect(decoded(resolveMediaUrl('/abs/path.png'))).toBe('/abs/path.png')
  })

  it('takes a Windows drive letter as absolute, with or without the URL slash', () => {
    expect(decoded(resolveMediaUrl('file:///C:/Users/a/x.png'))).toBe('C:/Users/a/x.png')
    expect(decoded(resolveMediaUrl('C:\\Users\\a\\x.png'))).toBe('C:\\Users\\a\\x.png')
  })

  it('carries a file version onto the URL rather than into the path', () => {
    const url = resolveMediaUrl('file:///c/nobilis/sneedchat-avatars/7.webp#1790000000')
    expect(decoded(url)).toBe('/c/nobilis/sneedchat-avatars/7.webp')
    expect(new URL(url).searchParams.get('v')).toBe('1790000000')
  })

  it('leaves remote URLs as they are', () => {
    expect(resolveMediaUrl('https://example.com/a.png')).toBe('https://example.com/a.png')
    expect(resolveMediaUrl('')).toBe('')
  })
})

describe('files', () => {
  it('names a file from either kind of path', () => {
    expect(fileNameOf('/home/a/b.PNG')).toBe('b.PNG')
    expect(fileNameOf('C:\\Users\\a\\b.png')).toBe('b.png')
    expect(isImageFile('C:\\x\\shot.JPEG')).toBe(true)
    expect(isImageFile('/x/notes.txt')).toBe(false)
  })

  it('writes sizes for a person to read', () => {
    expect(humanBytes(512)).toBe('512 B')
    expect(humanBytes(312 * 1024)).toBe('312 KB')
    expect(humanBytes(5.5 * 1024 ** 2)).toBe('5.5 MB')
    expect(humanBytes(1.2 * 1024 ** 3)).toBe('1.2 GB')
  })
})

describe('time', () => {
  const now = 1_790_000_000_000
  const at = (secondsAgo: number): number => now / 1000 - secondsAgo

  it('says how long ago, up to a day', () => {
    expect(formatRelativeTime(at(10), now)).toBe('just now')
    expect(formatRelativeTime(at(8 * 60), now)).toBe('8m ago')
    expect(formatRelativeTime(at(5 * 3600), now)).toBe('5h ago')
    expect(formatRelativeTime(at(30 * 3600), now)).toMatch(/^Yesterday at /)
  })

  it('never says a time in the future', () => {
    expect(formatRelativeTime(at(-60), now)).toBe('just now')
  })
})

describe('small things', () => {
  it('knows which kinds are somebody speaking', () => {
    for (const kind of ['chat', 'message', 'whisper', 'notice']) expect(isChatKind(kind)).toBe(true)
    for (const kind of ['join', 'system', undefined]) expect(isChatKind(kind)).toBe(false)
  })

  it('joins class names, skipping the falsy ones', () => {
    expect(classes('a', false, null, undefined, 'b', '')).toBe('a b')
  })
})

describe('date lines', () => {
  const noon = (y: number, m: number, d: number): number => Math.floor(new Date(y, m - 1, d, 12).getTime() / 1000)
  const now = new Date(2026, 9, 8, 15).getTime()

  it('says today and yesterday, and the date in full otherwise', () => {
    expect(dayLabel(noon(2026, 10, 8), now)).toBe('Today')
    expect(dayLabel(noon(2026, 10, 7), now)).toBe('Yesterday')
    expect(dayLabel(noon(2026, 3, 3), now)).toContain('2026')
    expect(dayLabel(noon(2025, 12, 31), now)).toContain('2025')
  })

  it('puts one before the first message and wherever the day changes', () => {
    const list = [{ ts: noon(2026, 10, 6) }, { ts: noon(2026, 10, 6) + 60 }, { ts: noon(2026, 10, 7) }, { ts: noon(2026, 10, 7) + 5 }]
    expect(list.map((_, i) => startsNewDay(list, i))).toEqual([true, false, true, false])
  })

  it('compares days by the clock on the wall, not by 24 hours', () => {
    const late = Math.floor(new Date(2026, 9, 7, 23, 59).getTime() / 1000)
    const early = Math.floor(new Date(2026, 9, 8, 0, 1).getTime() / 1000)
    expect(dayOf(late)).not.toBe(dayOf(early))
    expect(startsNewDay([{ ts: late }, { ts: early }], 1)).toBe(true)
  })

  it('leaves out a line with no time, without losing the day', () => {
    const list = [{ ts: noon(2026, 10, 7) }, { ts: 0 }, { ts: noon(2026, 10, 7) + 30 }]
    expect(startsNewDay(list, 1)).toBe(false)
    expect(startsNewDay(list, 2)).toBe(false)
  })
})

describe('relative times for a column', () => {
  const now = new Date(2026, 9, 8, 15).getTime()
  const ago = (s: number): number => Math.floor(now / 1000) - s

  it('stays short enough for a narrow column', () => {
    expect(formatRelativeShort(ago(10), now)).toBe('now')
    expect(formatRelativeShort(ago(8 * 60), now)).toBe('8m')
    expect(formatRelativeShort(ago(5 * 3600), now)).toBe('5h')
    expect(formatRelativeShort(ago(30 * 3600), now)).toBe('Yest')
    for (const s of [5, 600, 20000, 100000, 900000, 40000000]) {
      expect(formatRelativeShort(ago(s), now).length).toBeLessThanOrEqual(6)
    }
  })
})
