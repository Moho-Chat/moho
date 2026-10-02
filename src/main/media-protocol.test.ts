import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// The module registers an Electron protocol; none of that runs here, only
// the predicate that decides what the page may load.
vi.mock('electron', () => ({ net: {}, protocol: {} }))
vi.mock('./log', () => ({ log: { warn: () => {}, info: () => {} } }))

const { isAllowed } = await import('./media-protocol')

describe('the media scheme boundary', () => {
  let home: string
  let cache: string
  let outside: string

  beforeAll(() => {
    // Not under the system temp directory, which the scheme also serves
    // (the daemon writes a few things there) and which would make every
    // "outside" path here an inside one.
    const scratch = path.join(process.cwd(), 'node_modules', '.cache')
    fs.mkdirSync(scratch, { recursive: true })
    home = fs.mkdtempSync(path.join(scratch, 'moho-media-'))
    cache = path.join(home, 'cache', 'nobilis', 'matrix-media')
    fs.mkdirSync(cache, { recursive: true })
    outside = path.join(home, 'secret.txt')
    fs.writeFileSync(path.join(cache, 'a.png'), 'x')
    fs.writeFileSync(outside, 'x')
    fs.symlinkSync(outside, path.join(cache, 'link.png'))
    process.env.XDG_CACHE_HOME = path.join(home, 'cache')
    process.env.XDG_CONFIG_HOME = path.join(home, 'config')
  })

  afterAll(() => fs.rmSync(home, { recursive: true, force: true }))

  it('serves a file inside the daemon\'s cache', () => {
    expect(isAllowed(path.join(cache, 'a.png'))).toBe(true)
  })

  it('refuses anything outside it, however it is spelled', () => {
    expect(isAllowed(outside)).toBe(false)
    expect(isAllowed(path.join(cache, '..', '..', '..', 'secret.txt'))).toBe(false)
    expect(isAllowed('/etc/passwd')).toBe(false)
  })

  it('refuses a link planted inside that points out', () => {
    expect(isAllowed(path.join(cache, 'link.png'))).toBe(false)
  })

  it('refuses a file that is not there', () => {
    expect(isAllowed(path.join(cache, 'missing.png'))).toBe(false)
  })
})
