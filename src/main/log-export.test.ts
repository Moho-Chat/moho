import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Anonymizer, buildLogExport, exportFilename, readLogLines, type LogExportHeader } from './log-export'

const SAMPLE_HEADER: LogExportHeader = {
  mohoVersion: '1.5.9',
  mohoBuild: '4d21bc9',
  nobilisVersion: '1.5.9',
  nobilisBuild: '543575d',
  osType: 'Linux',
  osVersion: '6.12.0',
  osArch: 'x64',
  exportedAt: '2026-11-27T04:00:00.000Z'
}

describe('Anonymizer', () => {
  it('removes passwords, tokens, cookies, auth headers and JWTs', () => {
    const a = new Anonymizer()
    expect(a.line('[nobilis] matrix @Mohouser:matrix.org login token=syt_TW9ob3VzZXI ok')).toBe(
      '[nobilis] matrix user#1@server#1 login token=[removed] ok'
    )
    expect(a.line('POST /login password=supersecret cookie=sid=abc123')).toBe(
      'POST /login password=[removed] cookie=[removed]'
    )
    expect(a.line('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.signature123')).toBe(
      'Authorization: [removed]'
    )
    expect(a.line('{"token":"mfa.abcdefghijklmnopqrstuvwxyz12345","ok":true}')).toBe(
      '{"token":"[removed]","ok":true}'
    )
  })

  it('replaces usernames, guilds, servers and channels with consistent numbered placeholders', () => {
    const a = new Anonymizer()
    const l1 = a.line('[nobilis] discord: send to #general (guild Cozy Corner) by Mohouser failed: 429')
    const l2 = a.line('[nobilis] discord: send to #general (guild Cozy Corner) by Mohouser failed: 429')
    const l3 = a.line('[nobilis] discord: send to #random (guild Cozy Corner) by OtherUser failed: 429')
    expect(l1).toBe('[nobilis] discord: send to channel#1 (guild#1) by user#1 failed: 429')
    expect(l2).toBe(l1)
    expect(l3).toBe('[nobilis] discord: send to channel#2 (guild#1) by user#2 failed: 429')
  })

  it('replaces message text with its character length', () => {
    const a = new Anonymizer()
    expect(a.line('[nobilis] irc: <bob> hey are you coming tonight?')).toBe(
      '[nobilis] irc: [message, 27 chars]'
    )
    expect(a.line('PRIVMSG #secret :hello everyone here')).toBe(
      'PRIVMSG channel#1 :[message, 19 chars]'
    )
    expect(a.line('discord: an embed with only a title, as sent: {"title":"secret"}')).toBe(
      'discord: an embed with only a title, as sent: [message, 18 chars]'
    )
  })

  it('scrubs real-world nobilis account brackets, JIDs, home dirs, IPs and onion hosts', () => {
    const a = new Anonymizer()
    expect(
      a.line('2026-11-26T00:21:53.278Z info moho starting, logging to /home/alice/.cache/moho/moho.log')
    ).toBe('2026-11-26T00:21:53.278Z info moho starting, logging to /home/user#1/.cache/moho/moho.log')

    expect(
      a.line('INFO nobilis::backend::xmpp::connect: xmpp[xmpp:alice@example.org]: DNS says example.org:5223')
    ).toBe('INFO nobilis::backend::xmpp::connect: xmpp[user#1@server#1]: DNS says server#1:5223')

    expect(a.line('net: Tor relay listening on 127.0.0.1:42069 from 203.0.113.42')).toBe(
      'net: Tor relay listening on 127.0.0.1:42069 from ip#1'
    )

    expect(a.line('connecting to abcdefghijklmnop234567.onion')).toBe(
      'connecting to server#2.onion'
    )
  })
})

describe('buildLogExport', () => {
  it('keeps the full log with header when uncapped', () => {
    const res = buildLogExport(['line one', 'line two'], SAMPLE_HEADER)
    expect(res.linesOmitted).toBe(0)
    expect(res.totalLines).toBe(2)
    expect(res.text).toContain('moho: 1.5.9 (4d21bc9)')
    expect(res.text).toContain('nobilis: 1.5.9 (543575d)')
    expect(res.text).toContain('os: Linux 6.12.0 (x64)')
    expect(res.text).toContain('lines omitted: 0 (whole log)')
    expect(res.text).toContain('line one\nline two\n')
  })

  it('drops oldest lines first while always keeping the header and newest lines under maxBytes', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `2026-11-27T04:00:${String(i).padStart(2, '0')}Z line-${i} ${'x'.repeat(40)}`)
    const maxBytes = 600
    const res = buildLogExport(lines, SAMPLE_HEADER, { maxBytes })
    expect(res.sizeBytes).toBeLessThanOrEqual(maxBytes)
    expect(res.linesOmitted).toBeGreaterThan(0)
    expect(res.text).toContain('=== moho log export ===')
    expect(res.text).toContain(`lines omitted: ${res.linesOmitted}`)
    expect(res.text).toContain('line-49')
    expect(res.text).not.toContain('line-0 ')
  })
})

describe('readLogLines', () => {
  it('reads moho.log.1 before moho.log in chronological order', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moho-log-export-'))
    try {
      fs.writeFileSync(path.join(dir, 'moho.log.1'), 'old-1\nold-2\n')
      fs.writeFileSync(path.join(dir, 'moho.log'), 'new-1\nnew-2\n')
      const lines = await readLogLines(dir)
      expect(lines).toEqual(['old-1', 'old-2', 'new-1', 'new-2'])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('formats a safe timestamped filename', () => {
    const name = exportFilename(new Date(2026, 10, 26, 14, 5, 9))
    expect(name).toBe('moho-logs-2026-11-26-140509.txt')
  })
})
