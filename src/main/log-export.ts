import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** paste.gg's per-file limit: 5 MiB. */
export const PASTE_GG_MAX_BYTES = 5 * 1024 * 1024

export interface LogExportHeader {
  mohoVersion: string
  mohoBuild: string
  nobilisVersion: string
  nobilisBuild: string
  osType: string
  osVersion: string
  osArch: string
  exportedAt: string
}

export interface LogExportResult {
  text: string
  sizeBytes: number
  linesOmitted: number
  totalLines: number
}

/**
 * Consistent numbered placeholder table for a single export.
 *
 * The same username, server, guild, room, channel, account or IP gets the same
 * placeholder everywhere in one export (so a bug report can still follow a
 * single reconnect or rate-limit sequence across lines), and resets fresh on
 * the next export.
 */
export class Anonymizer {
  private maps = new Map<string, Map<string, string>>()

  /**
   * Optional known names (from the daemon's current account/buffer list) to
   * pre-seed so they are caught even inside free-form log lines.
   */
  constructor(known?: {
    users?: Iterable<string>
    servers?: Iterable<string>
    guilds?: Iterable<string>
    channels?: Iterable<string>
    rooms?: Iterable<string>
    accounts?: Iterable<string>
  }) {
    if (known?.accounts) for (const v of known.accounts) if (v) this.tag('account', v)
    if (known?.users) for (const v of known.users) if (v) this.tag('user', v)
    if (known?.servers) for (const v of known.servers) if (v) this.tag('server', v)
    if (known?.guilds) for (const v of known.guilds) if (v) this.tag('guild', v)
    if (known?.channels) for (const v of known.channels) if (v) this.tag('channel', v)
    if (known?.rooms) for (const v of known.rooms) if (v) this.tag('room', v)
  }

  tag(kind: 'user' | 'server' | 'guild' | 'channel' | 'room' | 'account' | 'ip', raw: string): string {
    const trimmed = raw.trim()
    if (!trimmed) return raw
    // Already replaced in an earlier pass.
    if (/^(user|server|guild|channel|room|account|ip)#\d+$/.test(trimmed)) return trimmed
    const key = trimmed.toLowerCase()
    let table = this.maps.get(kind)
    if (!table) {
      table = new Map()
      this.maps.set(kind, table)
    }
    let label = table.get(key)
    if (!label) {
      label = `${kind}#${table.size + 1}`
      table.set(key, label)
    }
    return label
  }

  /**
   * Anonymizes one log line.
   *
   * Two stages:
   * 1. Backend-aware rules that know the exact shapes each backend logs
   *    (account brackets, guild/channel paths, IRC/Matrix/XMPP/Discord/Sneedchat
   *    lines, message payloads).
   * 2. A general backstop pass for secrets (passwords, tokens, cookies, auth
   *    headers, JWTs), emails/JIDs, home directory usernames, onion hosts,
   *    channel names and IP addresses.
   */
  line(input: string): string {
    let s = input

    // --- Stage 1: Backend-aware structured patterns ---

    // Home directory paths: /home/<user>/, /Users/<user>/, C:\Users\<user>\
    s = s.replace(
      /(\/(?:home|Users)\/)([^/\s'"`]+)(\/|$|\s)/g,
      (_m, pre: string, u: string, post: string) => `${pre}${this.tag('user', u)}${post}`
    )
    s = s.replace(
      /([A-Za-z]:\\Users\\)([^\\\s'"`]+)(\\|$|\s)/g,
      (_m, pre: string, u: string, post: string) => `${pre}${this.tag('user', u)}${post}`
    )

    // Discord / Stoat / Fluxer / Sneedchat / XMPP / IRC / Matrix / Signal /
    // Telegram / Steam / Kick / Twitch account brackets:
    //   discord[discord:167790743988076545]
    //   xmpp[xmpp:alice@example.org] or xmpp[alice@example.org]
    //   sneedchat[sneedchat:Some User]
    s = s.replace(
      /\b(discord|irc|matrix|sneedchat|xmpp|telegram|signal|steam|stoat|fluxer|kick|twitch)\[([^\]]+)\]/gi,
      (_m, proto: string, inner: string) => {
        const lower = proto.toLowerCase()
        // Strip leading "<proto>:" if present.
        const stripped = inner.toLowerCase().startsWith(`${lower}:`) ? inner.slice(lower.length + 1) : inner
        // If inner looks like user@server, tag both parts.
        const at = stripped.indexOf('@')
        if (at > 0 && at < stripped.length - 1) {
          const u = this.tag('user', stripped.slice(0, at))
          const srv = this.tag('server', stripped.slice(at + 1).split('/')[0])
          return `${proto}[${u}@${srv}]`
        }
        const kind = lower === 'discord' || lower === 'stoat' || lower === 'fluxer' ? 'account' : 'user'
        return `${proto}[${this.tag(kind, inner)}]`
      }
    )

    // Buffer IDs with pipe separator: discord:12345|Guild Name/#channel-name
    // Negative lookbehind/lookahead on `:` avoids Rust module paths like `nobilis::backend::xmpp::connect:`.
    s = s.replace(
      /(?<!:)\b(discord|irc|matrix|sneedchat|xmpp|telegram|signal|steam|stoat|fluxer|kick|twitch):(?!:)([^|\s"']+)(?:\|([^/\s"'][^/\n"']*)\/(#?[^\s"',;:)]+))?/gi,
      (m, proto: string, acct: string, guild?: string, chan?: string) => {
        // Don't clobber already-tagged placeholders or plain "discord: rate limited" (space after colon).
        if (/^(account|user)#\d+$/.test(acct)) return m
        const aTag = this.tag('account', `${proto.toLowerCase()}:${acct}`)
        if (guild && chan) {
          return `${aTag}|${this.tag('guild', guild)}/${this.tag('channel', chan)}`
        }
        return `${proto}:${aTag}`
      }
    )

    // Runtime quoted buffer paths: `"Guild Name/Channel Name"` after an account id
    s = s.replace(
      /(account#\d+:\s*)"([^"/\n]+)\/([^"\n]+)"/g,
      (_m, pre: string, guild: string, chan: string) =>
        `${pre}"${this.tag('guild', guild)}/${this.tag('channel', chan)}"`
    )

    // Discord gateway/history lines: "a message in <guild>/<#channel>"
    s = s.replace(
      /(\ba message in\s+)([^/\n]+)\/(#?[^\s,;)]+)/gi,
      (_m, pre: string, guild: string, chan: string) =>
        `${pre}${this.tag('guild', guild)}/${this.tag('channel', chan)}`
    )

    // Discord/general "send to #channel (guild Foo Bar) by Username"
    s = s.replace(
      /(\b(?:send|sending) to\s+)(#[^\s(,:]+)(\s+\()guild\s+([^)]+)(\))(?:\s+by\s+([^\s,:]+))?/gi,
      (_m, pre: string, chan: string, gPre: string, guild: string, gPost: string, user?: string) => {
        const base = `${pre}${this.tag('channel', chan)}${gPre}${this.tag('guild', guild)}${gPost}`
        return user ? `${base} by ${this.tag('user', user)}` : base
      }
    )

    // Discord / REST API resource IDs in paths: /guilds/12345, /channels/12345, /users/12345
    s = s.replace(
      /\/(guilds|channels|users|rooms)\/([0-9]{10,22}|[A-Za-z0-9_-]{12,})/g,
      (_m, kind: string, id: string) => {
        const tagKind =
          kind === 'guilds'
            ? 'guild'
            : kind === 'channels'
              ? 'channel'
              : kind === 'rooms'
                ? 'room'
                : 'user'
        return `/${kind}/${this.tag(tagKind, id)}`
      }
    )

    // Discord golive/voice ids: guild:12345678901234567, channel:12345678901234567
    s = s.replace(
      /\b(guild|channel|room|user):([0-9]{6,22})\b/gi,
      (_m, kind: string, id: string) => {
        const k = kind.toLowerCase() as 'guild' | 'channel' | 'room' | 'user'
        return `${k}:${this.tag(k, id)}`
      }
    )

    // Telegram / grammers Channel(1234567890)
    s = s.replace(
      /\bChannel\((\d+)\)/g,
      (_m, id: string) => `Channel(${this.tag('channel', id)})`
    )

    // Discord embed JSON dump: `as sent: {...}`
    s = s.replace(
      /(\bas sent:\s*)(\{.*\})$/,
      (_m, pre: string, json: string) => `${pre}[message, ${json.length} chars]`
    )

    // JSON message text fields: "content":"...", "body":"...", "text":"..."
    s = s.replace(
      /"(content|body|text|message)"\s*:\s*"((?:\\.|[^"\\])*)"/gi,
      (_m, field: string, val: string) => `"${field}":"[message, ${val.length} chars]"`
    )

    // IRC raw PRIVMSG / NOTICE lines: PRIVMSG #chan :hello world
    s = s.replace(
      /\b(PRIVMSG|NOTICE)\s+(\S+)\s+:(.*)$/i,
      (_m, cmd: string, target: string, text: string) => {
        const t = target.startsWith('#') ? this.tag('channel', target) : this.tag('user', target)
        return `${cmd} ${t} :[message, ${text.length} chars]`
      }
    )

    // IRC/chat formatted `<nick> message text`
    s = s.replace(
      /(\b(?:irc|chat|sneedchat|discord|matrix|xmpp|telegram|signal)[^:\n]*:\s*)<([^>\s]+)>\s+(.+)$/i,
      (_m, pre: string, _nick: string, text: string) => `${pre}[message, ${text.length} chars]`
    )

    // IRC connection host: `Connecting via TLS to irc.libera.chat.`
    s = s.replace(
      /(\bConnecting(?:\s+via\s+\S+)?\s+to\s+)([A-Za-z0-9.-]+\.[A-Za-z]{2,})(\.?)/gi,
      (_m, pre: string, host: string, dot: string) =>
        host.toLowerCase().endsWith('.onion')
          ? `${pre}${this.tag('server', host)}.onion${dot}`
          : `${pre}${this.tag('server', host)}${dot}`
    )

    // XMPP DNS line: `DNS says host.tld:5223`
    s = s.replace(
      /(\bDNS says\s+)([A-Za-z0-9.-]+\.[A-Za-z]{2,})(:\d+)?/gi,
      (_m, pre: string, host: string, port?: string) => `${pre}${this.tag('server', host)}${port ?? ''}`
    )

    // Matrix identifiers: @user:server.tld, !roomid:server.tld, #alias:server.tld
    s = s.replace(
      /(^|[\s([{"'])([@!#])([A-Za-z0-9._=/-]+):([A-Za-z0-9.-]+\.[A-Za-z]{2,}(?::\d+)?)/g,
      (_m, pre: string, sigil: string, local: string, host: string) => {
        const srv = this.tag('server', host)
        if (sigil === '@') return `${pre}${this.tag('user', `${local}:${host}`)}@${srv}`
        if (sigil === '!') return `${pre}${this.tag('room', `${local}:${host}`)}@${srv}`
        return `${pre}${this.tag('channel', `${local}:${host}`)}@${srv}`
      }
    )

    // --- Stage 2: General backstop pass ---

    // Secrets: passwords, tokens, cookies, auth headers, API keys -> [removed]
    s = s.replace(
      /(\b(?:password|passwd|pass|token|access_token|refresh_token|auth_token|api_key|apikey|secret|cookie|session_id|sessionid|deletion_key)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&)]+)/gi,
      '$1[removed]'
    )
    s = s.replace(
      /"(password|passwd|pass|token|access_token|refresh_token|auth_token|api_key|apikey|secret|cookie|authorization|deletion_key)"\s*:\s*"(?:\\.|[^"\\])*"/gi,
      '"$1":"[removed]"'
    )
    s = s.replace(
      /(\b(?:Authorization|Set-Cookie|Cookie)\s*:\s*)(?:Bearer\s+|Basic\s+|Key\s+|token\s+)?[^\r\n;,]+/gi,
      '$1[removed]'
    )
    // IRC PASS / AUTHENTICATE commands
    s = s.replace(/\b(PASS|AUTHENTICATE)\s+\S+/g, '$1 [removed]')
    // Known token prefixes (Matrix syt_, Discord mfa., GitHub ghp_/gho_, JWTs)
    s = s.replace(/\b(?:syt_[A-Za-z0-9_=-]{6,}|mfa\.[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/g, '[removed]')
    s = s.replace(/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[removed]')

    // Onion addresses
    s = s.replace(
      /\b([a-z2-7]{16,56})\.onion\b/gi,
      (_m, addr: string) => `${this.tag('server', `${addr}.onion`)}.onion`
    )

    // Emails & JIDs: local@domain.tld (skip already anonymized user#N@server#M)
    s = s.replace(
      /\b([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,
      (_m, user: string, host: string) => `${this.tag('user', user)}@${this.tag('server', host)}`
    )

    // Phone numbers (e.g. Signal E.164 like +15551234567)
    s = s.replace(
      /(^|[\s([{"':])(\+[1-9]\d{6,14})\b/g,
      (_m, pre: string, phone: string) => `${pre}${this.tag('user', phone)}`
    )

    // Channel names: #channel-name (avoid hex colors #abcdef and pure numbers #343)
    s = s.replace(
      /(^|[\s([{"'/])#([A-Za-z][A-Za-z0-9_-]{1,63})\b/g,
      (m, pre: string, name: string) => {
        if (/^[0-9a-f]{3}$|^[0-9a-f]{6}$|^[0-9a-f]{8}$/i.test(name)) return m
        return `${pre}${this.tag('channel', `#${name}`)}`
      }
    )

    // IPv4 addresses (keep loopback 127.0.0.1 and 0.0.0.0 so Tor relay / local bind stays readable)
    s = s.replace(
      /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g,
      (ip: string) => {
        if (ip === '127.0.0.1' || ip === '0.0.0.0') return ip
        const parts = ip.split('.').map(Number)
        if (parts.some((n) => n > 255)) return ip
        return this.tag('ip', ip)
      }
    )

    // IPv6 addresses (bracketed or standalone with at least 2 colons and hex groups; keep ::1)
    s = s.replace(
      /\[([0-9a-f]{0,4}:[0-9a-f:]{2,39})\]/gi,
      (m, addr: string) => (addr === '::1' || addr === '::' ? m : `[${this.tag('ip', addr)}]`)
    )

    return s
  }
}

export function formatHeader(header: LogExportHeader, linesOmitted: number): string {
  const omittedNote =
    linesOmitted > 0
      ? `${linesOmitted.toLocaleString('en-US')} (oldest lines dropped to fit size limit)`
      : '0 (whole log)'
  return [
    '=== moho log export ===',
    `moho: ${header.mohoVersion} (${header.mohoBuild})`,
    `nobilis: ${header.nobilisVersion} (${header.nobilisBuild})`,
    `os: ${header.osType} ${header.osVersion} (${header.osArch})`,
    `exported: ${header.exportedAt}`,
    `lines omitted: ${omittedNote}`,
    '=======================',
    ''
  ].join('\n')
}

/**
 * Anonymizes raw log lines, prepends the always-kept header, and trims oldest
 * lines first when `maxBytes` is set.
 */
export function buildLogExport(
  rawLines: string[],
  header: LogExportHeader,
  options?: { maxBytes?: number; anonymizer?: Anonymizer }
): LogExportResult {
  const anonymizer = options?.anonymizer ?? new Anonymizer()
  const anonLines = rawLines.map((l) => anonymizer.line(l))
  const totalLines = anonLines.length
  const maxBytes = options?.maxBytes

  if (!maxBytes) {
    const text = formatHeader(header, 0) + anonLines.join('\n') + (anonLines.length ? '\n' : '')
    return {
      text,
      sizeBytes: Buffer.byteLength(text, 'utf8'),
      linesOmitted: 0,
      totalLines
    }
  }

  // First check if the whole log already fits.
  const fullHeader = formatHeader(header, 0)
  const fullHeaderBytes = Buffer.byteLength(fullHeader, 'utf8')
  const lineBytes = anonLines.map((l) => Buffer.byteLength(l, 'utf8') + 1) // +1 for '\n'
  let bodyBytes = 0
  for (const b of lineBytes) bodyBytes += b

  if (fullHeaderBytes + bodyBytes <= maxBytes) {
    const text = fullHeader + anonLines.join('\n') + (anonLines.length ? '\n' : '')
    return {
      text,
      sizeBytes: Buffer.byteLength(text, 'utf8'),
      linesOmitted: 0,
      totalLines
    }
  }

  // Drop oldest lines from index 0 upward until header(omitted) + remaining fits.
  // Re-check header size as `omitted` grows (digit count / commas can add a few bytes).
  let omitted = 0
  while (omitted < anonLines.length) {
    bodyBytes -= lineBytes[omitted]
    omitted++
    const h = formatHeader(header, omitted)
    if (Buffer.byteLength(h, 'utf8') + bodyBytes <= maxBytes) {
      const kept = anonLines.slice(omitted)
      const text = h + kept.join('\n') + (kept.length ? '\n' : '')
      return {
        text,
        sizeBytes: Buffer.byteLength(text, 'utf8'),
        linesOmitted: omitted,
        totalLines
      }
    }
  }

  // Even 0 lines exceeded maxBytes (only possible with a tiny test cap): keep header only.
  const h = formatHeader(header, anonLines.length)
  return {
    text: h,
    sizeBytes: Buffer.byteLength(h, 'utf8'),
    linesOmitted: anonLines.length,
    totalLines
  }
}

/**
 * Reads `moho.log.1` (if present) followed by `moho.log` (if present) from
 * `logDir`, returning all non-empty lines in chronological order.
 */
export async function readLogLines(logDir: string | null): Promise<string[]> {
  if (!logDir) return []
  const lines: string[] = []
  for (const name of ['moho.log.1', 'moho.log']) {
    try {
      const content = await fsp.readFile(path.join(logDir, name), 'utf8')
      for (const line of content.split(/\r?\n/)) {
        if (line.length > 0) lines.push(line)
      }
    } catch {
      // Missing generation (e.g. before first rotation) is normal.
    }
  }
  return lines
}

/** Default OS metadata for the export header. */
export function currentOsInfo(): Pick<LogExportHeader, 'osType' | 'osVersion' | 'osArch'> {
  return {
    osType: os.type(),
    osVersion: os.release(),
    osArch: os.arch()
  }
}

/** Timestamped filename for saving to Downloads, e.g. `moho-logs-2026-11-26-231500.txt`. */
export function exportFilename(now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `moho-logs-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.txt`
}
