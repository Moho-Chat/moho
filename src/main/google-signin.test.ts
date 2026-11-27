import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { chatCookies, firefoxUserAgent, readCookies } from './google-signin'

// Loaded at run time: the bundler would take the `node:` off, and `sqlite` alone is not a module.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')

describe('the Google sign-in in Firefox', () => {
  it('keeps the cookies the web app sends to chat.google.com/u/0/, the more specific one first', () => {
    const jar = chatCookies([
      { name: 'SID', value: 'sid', host: '.google.com', path: '/' },
      { name: 'OSID', value: 'accounts-osid', host: 'accounts.google.com', path: '/' },
      { name: 'OSID', value: 'chat-osid', host: 'chat.google.com', path: '/' },
      { name: 'COMPASS', value: 'root', host: 'chat.google.com', path: '/' },
      { name: 'COMPASS', value: 'u0', host: 'chat.google.com', path: '/u/0' },
      { name: 'COMPASS', value: 'webchannel', host: 'chat.google.com', path: '/u/0/webchannel' },
      { name: 'NID', value: 'other', host: '.youtube.com', path: '/' },
      { name: 'GMAIL_AT', value: 'mail', host: 'mail.google.com', path: '/' }
    ])
    expect(Object.fromEntries(jar)).toEqual({ SID: 'sid', OSID: 'chat-osid', COMPASS: 'u0' })
  })

  it('writes Firefox’s user agent the way Firefox does', () => {
    expect(firefoxUserAgent('160.0.1', 'linux')).toBe('Mozilla/5.0 (X11; Linux x86_64; rv:160.0) Gecko/20100101 Firefox/160.0')
    expect(firefoxUserAgent('160.0', 'win32')).toContain('(Windows NT 10.0; Win64; x64; rv:160.0)')
  })

  it('reads a cookie file Firefox still has open, including what is only in its write-ahead log', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'moho-google-test-'))
    const profile = path.join(base, 'profile')
    const scratch = path.join(base, 'read')
    fs.mkdirSync(profile)
    fs.mkdirSync(scratch)
    const db = new DatabaseSync(path.join(profile, 'cookies.sqlite'))
    try {
      db.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0')
      db.exec('CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY, name TEXT, value TEXT, host TEXT, path TEXT)')
      db.prepare('INSERT INTO moz_cookies (name, value, host, path) VALUES (?, ?, ?, ?)').run('SID', 'sid', '.google.com', '/')
      db.prepare('INSERT INTO moz_cookies (name, value, host, path) VALUES (?, ?, ?, ?)').run('COMPASS', 'c', 'chat.google.com', '/')
      db.prepare('INSERT INTO moz_cookies (name, value, host, path) VALUES (?, ?, ?, ?)').run('x', 'y', '.example.com', '/')
      expect(fs.existsSync(path.join(profile, 'cookies.sqlite-wal'))).toBe(true)
      const rows = readCookies(profile, scratch)
      expect(rows.map((r) => r.name).sort()).toEqual(['COMPASS', 'SID'])
    } finally {
      db.close()
      fs.rmSync(base, { recursive: true, force: true })
    }
  })
})
