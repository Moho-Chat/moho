import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  Anonymizer,
  buildLogExport,
  exportFilename,
  normalizeLogLine,
  parseNobilisTracingLine,
  readLogLines,
  type LogExportHeader
} from './log-export'

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

  it('scrubs handles, XMPP/Matrix hosts, signed URLs, snowflakes, UUIDs and Telegram cache IDs', () => {
    const a = new Anonymizer()

    expect(
      a.line('discord[discord:12345]: ready as Alice (from the last run)')
    ).toBe('discord[account#1]: ready as user#1 (from the last run)')

    expect(
      a.line('telegram[telegram:5173409493]: connected as 5173409493 (alice)')
    ).toBe('telegram[user#2]: connected as user#2 (user#1)')

    expect(
      a.line('fluxer[fluxer:1572629570329247745]: connected as 1572629570329247745')
    ).toBe('fluxer[account#2]: connected as user#3')

    expect(
      a.line('irc[irc:alice@irc.example.net]: the server closed the connection: Closing Link: Alice[203.0.113.9] (Quit: moho)')
    ).toBe('irc[user#1@server#1]: the server closed the connection: Closing Link: user#1[ip#1] (Quit: moho)')

    expect(
      a.line('xmpp[xmpp:alice@example.org]: DNS says example.org:5223 (TLS), backup.example.org:5222')
    ).toBe('xmpp[user#1@server#2]: DNS says server#2:5223 (TLS), server#3:5222')

    expect(
      a.line('xmpp[xmpp:alice@example.org]: reached backup.example.org:5222 (STARTTLS)')
    ).toBe('xmpp[user#1@server#2]: reached server#3:5222 (STARTTLS)')

    expect(
      a.line('sync request failed: error sending request for url (https://matrix.example.org/_matrix/client/v3/sync?timeout=30000&since=s7219_abc)')
    ).toBe('sync request failed: error sending request for url (https://server#4/_matrix/client/v3/sync?timeout=30000&since=[removed])')

    expect(
      a.line('sneedchat: fetching file 01a212a5-c34c-7339-bf0f-5385155198ee: GET https://uploads.abcdefghijklmnop234567.onion/chat/files/01a212a5-c34c-7339-bf0f-5385155198ee.SECRETKEY/video?t=LongSignedBearerToken1234567890')
    ).toBe('sneedchat: fetching file file#1: GET https://server#5.onion/chat/files/file#2/video?t=[removed]')

    // Safe documentation URLs remain intact for TLS error debugging
    expect(
      a.line('peer closed connection: https://docs.rs/rustls/latest/rustls/manual/_03_howto/index.html#unexpected-eof')
    ).toBe('peer closed connection: https://docs.rs/rustls/latest/rustls/manual/_03_howto/index.html#unexpected-eof')

    expect(
      a.line('discord[account#1]: 1546869660610330739 is sharing a screen in 1571919741659123712')
    ).toBe('discord[account#1]: user#4 is sharing a screen in channel#1')

    expect(
      a.line('discord[account#1]: 1546869660610330739 is sharing a screen and on camera in 1571919741659123712')
    ).toBe('discord[account#1]: user#4 is sharing a screen and on camera in channel#1')

    expect(
      a.line('net: Tor could not reach uploads.example.net:443 (timeout)')
    ).toBe('net: Tor could not reach server#6:443 (timeout)')

    expect(
      a.line('discord[account#1]: a message in 1571919741659123712 was dropped - that channel is not one this connection knows')
    ).toBe('discord[account#1]: a message in channel#1 was dropped - that channel is not one this connection knows')

    expect(
      a.line('VOICE_CHANNEL_START_TIME_UPDATE {"guild_id":"111111111111111111","id":"222222222222222222"}')
    ).toBe('VOICE_CHANNEL_START_TIME_UPDATE {"guild_id":"guild#1","id":"channel#2"}')

    expect(
      a.line('sneedchat: avatar fetch for user 019e61be-5c91-786f-a627-676e40a12038 returned HTTP 203')
    ).toBe('sneedchat: avatar fetch for user user#5 returned HTTP 203')

    expect(
      a.line('[restore] telegram-media/tg_5173409493_n1001161666782_178866_thumb.jpg asked for')
    ).toBe('[restore] telegram-media/tg_user#2_channel#3_file#3_thumb.jpg asked for')
  })

  it('scrubs pre-seeded known names anywhere in free-form lines without mangling stopwords', () => {
    const a = new Anonymizer({
      users: ['Salastil', 'info'],
      servers: ['matrix.poast.org'],
      guilds: ['Cozy Corner', 'general']
    })
    expect(
      a.line('2026-11-27T04:00:00.000Z info error talking to matrix.poast.org as Salastil in Cozy Corner')
    ).toBe('2026-11-27T04:00:00.000Z info error talking to server#1 as user#1 in guild#1')
  })
})

describe('normalizeLogLine and parseNobilisTracingLine', () => {
  it('strips duplicate timestamp and promotes real nobilis severity level', () => {
    const legacy =
      '2026-11-25T06:46:51.092Z info [nobilis] 2026-11-25T06:46:51.092746Z  WARN nobilis::backend::kick::socket: kick[user#2]: limit exceeded'
    expect(normalizeLogLine(legacy)).toBe(
      '2026-11-25T06:46:51.092746Z warn [nobilis] nobilis::backend::kick::socket: kick[user#2]: limit exceeded'
    )
    expect(
      parseNobilisTracingLine('2026-11-25T06:46:51.092746Z  ERROR nobilis::rpc: handler panicked')
    ).toEqual({
      timestamp: '2026-11-25T06:46:51.092746Z',
      level: 'error',
      rawLevel: 'ERROR',
      rest: 'nobilis::rpc: handler panicked'
    })
  })
})

describe('buildLogExport', () => {
  it('keeps the full log with header and sorts newest-to-oldest when uncapped', () => {
    const res = buildLogExport(['line one', 'line two'], {
      ...SAMPLE_HEADER,
      electronVersion: '44.4.4',
      chromeVersion: '136.0.0.0',
      displayServer: 'wayland',
      packaging: 'AppImage',
      sandboxed: true,
      tunnel: 'direct',
      backends: 'discord(1/1), irc(2/2)'
    })
    expect(res.linesOmitted).toBe(0)
    expect(res.linesCollapsed).toBe(0)
    expect(res.totalLines).toBe(2)
    expect(res.text).toContain('moho: 1.5.9 (4d21bc9)')
    expect(res.text).toContain('nobilis: 1.5.9 (543575d)')
    expect(res.text).toContain('runtime: Electron 44.4.4 / Chromium 136.0.0.0')
    expect(res.text).toContain('os: Linux 6.12.0 (x64)')
    expect(res.text).toContain('env: display=wayland, packaging=AppImage, sandbox=on')
    expect(res.text).toContain('tunnel: direct')
    expect(res.text).toContain('backends: discord(1/1), irc(2/2)')
    expect(res.text).toContain('order: newest first')
    expect(res.text).toContain('lines omitted: 0 (whole log)')
    expect(res.text).toContain('line two\nline one\n')
  })

  it('preserves multi-line stack traces attached to their entry when reversed newest-first', () => {
    const raw = [
      '2026-11-27T04:00:00.000Z error [moho] render failed: TypeError: boom',
      '    at MessageList (app.js:10:2)',
      '    at App (app.js:40:4)',
      '2026-11-27T04:00:05.000Z info moho quitting'
    ]
    const res = buildLogExport(raw, SAMPLE_HEADER)
    const body = res.text.split('=======================\n')[1]
    expect(body).toBe(
      [
        '2026-11-27T04:00:05.000Z info moho quitting',
        '2026-11-27T04:00:00.000Z error [moho] render failed: TypeError: boom',
        '    at MessageList (app.js:10:2)',
        '    at App (app.js:40:4)',
        ''
      ].join('\n')
    )
  })

  it('collapses consecutive identical repeats and compacts repetitive info bursts while keeping warns/errors', () => {
    const raw: string[] = []
    for (let i = 0; i < 5; i++) {
      raw.push(
        `2026-11-27T04:00:0${i}.000Z info [nobilis] 2026-11-27T04:00:0${i}.000000Z  WARN nobilis::backend::kick::socket: kick[user#1]: limit exceeded (106)`
      )
    }
    for (let i = 0; i < 20; i++) {
      const uid = `019e61be-5c91-786f-a627-676e40a1${String(i).padStart(4, '0')}`
      raw.push(
        `2026-11-27T04:01:${String(i).padStart(2, '0')}.000Z info [nobilis] 2026-11-27T04:01:${String(i).padStart(2, '0')}.000000Z  INFO nobilis::backend::sneedchat::media: sneedchat: avatar fetch for user ${uid} returned HTTP 203`
      )
    }
    raw.push('2026-11-27T04:02:00.000Z error [process] GPU process gone - crashed (exit code 133)')

    const res = buildLogExport(raw, SAMPLE_HEADER)
    expect(res.linesCollapsed).toBeGreaterThan(15)
    expect(res.text).toContain('lines collapsed:')
    // Consecutive warn collapsed with count
    expect(res.text).toContain('warn [nobilis] nobilis::backend::kick::socket: kick[user#1]: limit exceeded (106) (×5, 04:00:00Z..04:00:04Z)')
    // Info burst compacted to edges + summary
    expect(res.text).toContain('[export] collapsed 16× similar lines:')
    // Newest entry (GPU crash) is right under the header
    const firstBodyLine = res.text.split('=======================\n')[1].split('\n')[0]
    expect(firstBodyLine).toBe(
      '2026-11-27T04:02:00.000Z error [process] GPU process gone - crashed (exit code 133)'
    )
  })

  it('drops oldest lines first while always keeping the header and newest lines under maxBytes', () => {
    const lines = Array.from(
      { length: 50 },
      (_, i) => `2026-11-27T04:00:${String(i).padStart(2, '0')}Z line-${i} ${'x'.repeat(40)}`
    )
    const maxBytes = 650
    const res = buildLogExport(lines, SAMPLE_HEADER, { maxBytes })
    expect(res.sizeBytes).toBeLessThanOrEqual(maxBytes)
    expect(res.linesOmitted).toBeGreaterThan(0)
    expect(res.text).toContain('=== moho log export ===')
    expect(res.text).toContain(`lines omitted: ${res.linesOmitted}`)
    expect(res.text).toContain('line-49')
    expect(res.text).not.toContain('line-0 ')
    // Newest line appears before older kept line
    expect(res.text.indexOf('line-49')).toBeLessThan(res.text.indexOf('line-48'))
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
