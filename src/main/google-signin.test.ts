import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { browserFromCommand, chatCookies, engineOf, firefoxUserAgent, parseExec, readCookies, readDesktopEntry, windowsProgram } from './google-signin'

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

  it('reads the default browser’s desktop entry the way a launcher does', () => {
    const entry = readDesktopEntry(
      '[Desktop Entry]\nName=Firefox\nExec=/usr/lib/firefox/firefox %u\n\n[Desktop Action new-private-window]\nName=New Private Window\nExec=/usr/lib/firefox/firefox --private-window %u\n'
    )
    expect(entry).toEqual({ name: 'Firefox', exec: '/usr/lib/firefox/firefox %u' })
    expect(parseExec(entry.exec ?? '')).toEqual(['/usr/lib/firefox/firefox'])
    expect(parseExec('"/opt/my browser/chrome" --flag "%U"')).toEqual(['/opt/my browser/chrome', '--flag'])
  })

  it('knows the engine of the usual browsers, and nothing of the rest', () => {
    for (const n of ['firefox', 'librewolf', 'org.mozilla.firefox', 'firefox.exe', 'io.gitlab.librewolf-community']) expect(engineOf(n)).toBe('gecko')
    for (const n of ['google-chrome-stable', 'chromium', 'brave', 'msedge.exe', 'microsoft-edge-stable', 'com.brave.Browser', 'vivaldi-stable', 'chrome.exe'])
      expect(engineOf(n)).toBe('chromium')
    for (const n of ['epiphany', 'falkon', 'konqueror', 'org.gnome.Epiphany']) expect(engineOf(n)).toBeNull()
  })

  it('gives a Flatpak or Snap a profile where its sandbox can reach it', () => {
    const flat = browserFromCommand(parseExec('/usr/bin/flatpak run --branch=stable --arch=x86_64 --command=brave com.brave.Browser @@u %u @@'), 'Brave', true, '/home/u')
    expect(flat).toMatchObject({ engine: 'chromium', profileBase: '/home/u/.var/app/com.brave.Browser' })
    expect(flat?.command).toEqual(['/usr/bin/flatpak', 'run', '--branch=stable', '--arch=x86_64', '--command=brave', 'com.brave.Browser'])
    const snap = browserFromCommand(['/snap/bin/firefox'], 'Firefox', true, '/home/u')
    expect(snap).toMatchObject({ engine: 'gecko', profileBase: '/home/u/snap/firefox/common' })
    expect(browserFromCommand(['/usr/bin/epiphany'], 'Web', true)).toBeNull()
  })

  it('finds the program in a Windows open command', () => {
    expect(windowsProgram('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --single-argument %1')).toBe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
    expect(windowsProgram('"C:\\Program Files\\Mozilla Firefox\\firefox.exe" -osint -url "%1"')).toBe('C:\\Program Files\\Mozilla Firefox\\firefox.exe')
    expect(windowsProgram('C:\\Apps\\browser.exe %1')).toBe('C:\\Apps\\browser.exe')
  })
})
