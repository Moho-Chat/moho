import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// The module registers an Electron protocol; none of that runs here, only
// the predicate that decides what the page may load.
vi.mock('electron', () => ({ net: {}, protocol: {} }))
vi.mock('./log', () => ({ log: { warn: () => {}, info: () => {} } }))

const { isAllowed, isMediaBytes } = await import('./media-protocol')

describe('the media scheme boundary', () => {
  let home: string
  let cache: string
  let outside: string

  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  let stickers: string

  beforeAll(() => {
    // Not under the system temp directory - the scheme used to serve all of
    // it, and a fixture there would hide exactly the failure being tested.
    const scratch = path.join(process.cwd(), 'node_modules', '.cache')
    fs.mkdirSync(scratch, { recursive: true })
    home = fs.mkdtempSync(path.join(scratch, 'moho-media-'))
    cache = path.join(home, 'cache', 'nobilis', 'matrix-media')
    stickers = path.join(home, 'cache', 'nobilis', 'discord-stickers')
    fs.mkdirSync(cache, { recursive: true })
    fs.mkdirSync(stickers, { recursive: true })
    fs.mkdirSync(path.join(cache, 'nested'))
    fs.mkdirSync(path.join(home, 'config', 'nobilis'), { recursive: true })
    outside = path.join(home, 'secret.png')
    fs.writeFileSync(path.join(cache, 'a.png'), PNG)
    fs.writeFileSync(path.join(cache, 'nested', 'b.png'), PNG)
    fs.writeFileSync(path.join(cache, 'accounts.png'), '[account]\ntoken = "secret"\n')
    fs.writeFileSync(path.join(home, 'config', 'nobilis', 'scrollback.png'), PNG)
    fs.writeFileSync(path.join(stickers, '1.json'), '{"v":"5.7"}')
    fs.writeFileSync(path.join(cache, '2.json'), '{"v":"5.7"}')
    fs.writeFileSync(outside, PNG)
    fs.symlinkSync(outside, path.join(cache, 'link.png'))
    process.env.XDG_CACHE_HOME = path.join(home, 'cache')
    process.env.XDG_CONFIG_HOME = path.join(home, 'config')
  })

  afterAll(() => fs.rmSync(home, { recursive: true, force: true }))

  it("serves a picture inside the daemon's cache", () => {
    expect(isAllowed(path.join(cache, 'a.png'))).toBe(true)
  })

  it('refuses anything outside it, however it is spelled', () => {
    expect(isAllowed(outside)).toBe(false)
    expect(isAllowed(path.join(cache, '..', '..', '..', 'secret.png'))).toBe(false)
    expect(isAllowed('/etc/passwd')).toBe(false)
  })

  it('refuses a link planted inside that points out', () => {
    expect(isAllowed(path.join(cache, 'link.png'))).toBe(false)
  })

  it('refuses a file that is not there', () => {
    expect(isAllowed(path.join(cache, 'missing.png'))).toBe(false)
  })

  it('refuses what is not a picture, a video or audio, whatever it is called', () => {
    expect(isAllowed(path.join(cache, 'accounts.png'))).toBe(false)
  })

  it("refuses the daemon's config directory, picture or not", () => {
    expect(isAllowed(path.join(home, 'config', 'nobilis', 'scrollback.png'))).toBe(false)
  })

  it('refuses anything nested below a cache folder', () => {
    expect(isAllowed(path.join(cache, 'nested', 'b.png'))).toBe(false)
  })

  it("serves a sticker's animation, and JSON nowhere else", () => {
    expect(isAllowed(path.join(stickers, '1.json'))).toBe(true)
    expect(isAllowed(path.join(cache, '2.json'))).toBe(false)
  })

  it('refuses the system temp directory', () => {
    const loose = path.join(os.tmpdir(), `moho-media-loose-${process.pid}.png`)
    fs.writeFileSync(loose, PNG)
    try {
      expect(isAllowed(loose)).toBe(false)
    } finally {
      fs.rmSync(loose, { force: true })
    }
  })
})

describe('what counts as media', () => {
  const bytes = (...b: (number | string)[]): Uint8Array =>
    Uint8Array.from(b.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : [x])))

  it('knows pictures, video and audio by their first bytes', () => {
    expect(isMediaBytes(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true)
    expect(isMediaBytes(bytes('GIF89a'))).toBe(true)
    expect(isMediaBytes(bytes('RIFF', 0, 0, 0, 0, 'WEBP'))).toBe(true)
    expect(isMediaBytes(bytes(0, 0, 0, 0x20, 'ftypisom'))).toBe(true)
    expect(isMediaBytes(bytes('OggS'))).toBe(true)
  })

  it('refuses text, keys and databases', () => {
    expect(isMediaBytes(bytes('[account]'))).toBe(false)
    expect(isMediaBytes(bytes('SQLite format 3'))).toBe(false)
    expect(isMediaBytes(bytes('-----BEGIN'))).toBe(false)
    expect(isMediaBytes(bytes('{"a":1}'))).toBe(false)
    expect(isMediaBytes(bytes('{"a":1}'), true)).toBe(true)
  })
})
