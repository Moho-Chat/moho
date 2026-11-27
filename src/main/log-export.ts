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
  electronVersion?: string
  chromeVersion?: string
  displayServer?: string
  packaging?: string
  sandboxed?: boolean
  tunnel?: string
  backends?: string
}

export interface LogExportResult {
  text: string
  sizeBytes: number
  linesOmitted: number
  linesCollapsed: number
  totalLines: number
}

export type AnonymizerTagKind =
  | 'user'
  | 'server'
  | 'guild'
  | 'channel'
  | 'room'
  | 'account'
  | 'ip'
  | 'file'

export interface KnownAnonymizerNames {
  users?: Iterable<string>
  servers?: Iterable<string>
  guilds?: Iterable<string>
  channels?: Iterable<string>
  rooms?: Iterable<string>
  accounts?: Iterable<string>
}

const SAFE_DOC_HOSTS = new Set([
  'docs.rs',
  'github.com',
  'developer.mozilla.org',
  'datatracker.ietf.org'
])

/**
 * Common log/protocol words that must never be replaced by free-form `known`
 * matching even if a user happens to have a guild, channel or account named
 * after one of them.
 */
const KNOWN_STOPWORDS = new Set([
  'moho',
  'nobilis',
  'info',
  'warn',
  'error',
  'debug',
  'trace',
  'discord',
  'irc',
  'matrix',
  'sneedchat',
  'xmpp',
  'telegram',
  'signal',
  'steam',
  'stoat',
  'fluxer',
  'rocketchat',
  'kick',
  'twitch',
  'jabber',
  'slack',
  'general',
  'random',
  'lobby',
  'system',
  'server',
  'channel',
  'room',
  'user',
  'account',
  'guild',
  'direct',
  'online',
  'offline',
  'ready',
  'connected',
  'closed',
  'failed',
  'timeout',
  'http',
  'https',
  'localhost',
  'tor',
  'proxy',
  'chat',
  'media',
  'video',
  'audio',
  'image',
  'file',
  'files',
  'avatar',
  'avatars',
  'main',
  'window',
  'call',
  'restore',
  'export',
  'none',
  'null',
  'true',
  'false',
  'unknown',
  'socket',
  'gateway',
  'sync',
  'login',
  'connect',
  'events',
  'message',
  'messages',
  'nowhere'
])

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Parses a raw `tracing_subscriber` line emitted by `nobilis` so we can hoist
 * its real severity level and drop the duplicated timestamp.
 */
export function parseNobilisTracingLine(
  raw: string
): { timestamp: string; level: 'info' | 'warn' | 'error'; rawLevel: string; rest: string } | null {
  const m = raw.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+(.*)$/
  )
  if (!m) return null
  const [, timestamp, rawLevel, rest] = m
  const level: 'info' | 'warn' | 'error' =
    rawLevel === 'ERROR' ? 'error' : rawLevel === 'WARN' ? 'warn' : 'info'
  return { timestamp, level, rawLevel, rest }
}

/**
 * Strips the redundant outer timestamp and `info` level from legacy `moho.log`
 * lines where `nobilis-process` piped `tracing_subscriber` output verbatim:
 *   `<ts1> info [nobilis] <ts2>  WARN target: msg`
 * becomes:
 *   `<ts2> warn [nobilis] target: msg`
 */
export function normalizeLogLine(line: string): string {
  const outer = line.match(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s+(?:info|warn|error)\s+\[nobilis\]\s+(.*)$/
  )
  if (!outer) return line
  const inner = parseNobilisTracingLine(outer[1])
  if (!inner) return line
  return `${inner.timestamp} ${inner.rawLevel.toLowerCase()} [nobilis] ${inner.rest}`
}

/**
 * Consistent numbered placeholder table for a single export.
 *
 * The same username, server, guild, room, channel, account, file or IP gets the
 * same placeholder everywhere in one export (so a bug report can still follow a
 * single reconnect or rate-limit sequence across lines), and resets fresh on
 * the next export.
 */
export class Anonymizer {
  private maps = new Map<string, Map<string, string>>()
  private knownPatterns: Array<{ kind: AnonymizerTagKind; raw: string; re: RegExp }> = []

  /**
   * Optional known names (from the daemon's current account/buffer list) to
   * pre-seed so they are caught even inside free-form log lines.
   */
  constructor(known?: KnownAnonymizerNames) {
    const seen = new Set<string>()
    const addKnown = (kind: AnonymizerTagKind, values?: Iterable<string>, minLen = 3): void => {
      if (!values) return
      for (const raw of values) {
        const trimmed = raw.trim()
        if (!trimmed) continue
        this.tag(kind, trimmed)
        const lower = trimmed.toLowerCase()
        if (trimmed.length < minLen || KNOWN_STOPWORDS.has(lower)) continue
        if (/^(user|server|guild|channel|room|account|ip|file)#\d+$/.test(lower)) continue
        const dedupeKey = `${kind}:${lower}`
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)
        const re = new RegExp(`(?<![A-Za-z0-9_:#])${escapeRegex(trimmed)}(?![A-Za-z0-9_:])`, 'gi')
        this.knownPatterns.push({ kind, raw: trimmed, re })
      }
    }
    addKnown('account', known?.accounts, 4)
    addKnown('user', known?.users, 3)
    addKnown('server', known?.servers, 4)
    addKnown('guild', known?.guilds, 4)
    addKnown('channel', known?.channels, 4)
    addKnown('room', known?.rooms, 4)
    // Longest names first so a full hostname or display name matches before a substring.
    this.knownPatterns.sort((a, b) => b.raw.length - a.raw.length)
  }

  tag(kind: AnonymizerTagKind, raw: string): string {
    const trimmed = raw.trim()
    if (!trimmed) return raw
    // Already replaced in an earlier pass.
    if (/^(user|server|guild|channel|room|account|ip|file)#\d+$/.test(trimmed)) return trimmed
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
   *    lines, URLs, snowflakes, UUIDs, message payloads) plus pre-seeded known
   *    names from the live daemon.
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
      /\b(discord|irc|matrix|sneedchat|xmpp|telegram|signal|steam|stoat|fluxer|rocketchat|kick|twitch)\[([^\]]+)\]/gi,
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
        const kind = lower === 'discord' || lower === 'stoat' || lower === 'fluxer' || lower === 'rocketchat' ? 'account' : 'user'
        return `${proto}[${this.tag(kind, kind === 'user' ? stripped : inner)}]`
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

    // Runtime buffer / friend rename lines:
    //   fluxer:account#20 "Claude.City./repos-and-forks" is now "guild#1/channel#89", 0 messages moved
    //   steam:account#18 "Grath" is now "user#86", 0 messages moved
    //   account#2: moving "Guild Name/Old" to "Guild Name/New": ...
    const scrubQuotedBuffer = (proto: string | undefined, raw: string): string => {
      const slash = raw.indexOf('/')
      if (slash > 0 && slash < raw.length - 1) {
        const g = raw.slice(0, slash)
        const c = raw.slice(slash + 1)
        return `${this.tag('guild', g)}/${this.tag('channel', c)}`
      }
      const p = (proto ?? '').toLowerCase()
      if (p === 'steam' || p === 'signal' || p === 'telegram') return this.tag('user', raw)
      if (raw.startsWith('#')) return this.tag('channel', raw)
      return this.tag('room', raw)
    }
    s = s.replace(
      /(\b(?:(discord|irc|matrix|sneedchat|xmpp|telegram|signal|steam|stoat|fluxer|kick|twitch):)?account#\d+:?\s+(?:moving\s+)?)"([^"\n]+)"(\s+(?:is now|to)\s+)"([^"\n]+)"/gi,
      (_m, pre: string, proto: string | undefined, from: string, mid: string, to: string) =>
        `${pre}"${scrubQuotedBuffer(proto, from)}"${mid}"${scrubQuotedBuffer(proto, to)}"`
    )

    // Runtime quoted buffer paths: `"Guild Name/Channel Name"` after an account id
    s = s.replace(
      /(account#\d+:\s*)"([^"/\n]+)\/([^"\n]+)"/g,
      (_m, pre: string, guild: string, chan: string) =>
        `${pre}"${this.tag('guild', guild)}/${this.tag('channel', chan)}"`
    )

    // Identity confirmations:
    //   telegram[user#7]: connected as 5173409493 (alice)
    //   fluxer[account#6]: connected as 1572629570329247745
    //   discord[account#2]: ready as Alice (from the last run)
    s = s.replace(
      /\b(ready as|connected as)\s+(\d{5,22})\s+\(([^)]+)\)/gi,
      (_m, verb: string, id: string, nick: string) =>
        `${verb} ${this.tag('user', id)} (${this.tag('user', nick)})`
    )
    s = s.replace(
      /\b(ready as|connected as)\s+(\d{5,22})\b/gi,
      (_m, verb: string, id: string) => `${verb} ${this.tag('user', id)}`
    )
    s = s.replace(
      /\b(ready as|connected as)\s+([^\s(,:;]+)/gi,
      (m, verb: string, nick: string) => {
        if (/^(user|account)#\d+$/i.test(nick)) return m
        return `${verb} ${this.tag('user', nick)}`
      }
    )

    // IRC disconnect notice: `Closing Link: Alice[203.0.113.1] (Quit: moho)`
    s = s.replace(
      /(\bClosing Link:\s*)([^\s[]+)(\[)/gi,
      (m, pre: string, nick: string, br: string) => {
        if (/^(user|ip)#\d+$/i.test(nick) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(nick)) return m
        return `${pre}${this.tag('user', nick)}${br}`
      }
    )

    // Discord / Fluxer raw screen-share / camera snowflakes:
    //   discord[account#2]: 1546869660610330739 is sharing a screen in 1571919741659123712
    //   discord[account#2]: 643251366894239762 is sharing a screen and on camera in 1571919741659123712
    s = s.replace(
      /(\b(?:discord|fluxer|stoat)\[[^\]]+\]:\s*)(\d{15,22})(\s+is (?:sharing a screen(?:\s+and on camera)?|on camera)\s+in\s+)(\d{15,22}|nowhere)\b/gi,
      (_m, pre: string, uid: string, mid: string, loc: string) =>
        `${pre}${this.tag('user', uid)}${mid}${loc === 'nowhere' ? 'nowhere' : this.tag('channel', loc)}`
    )

    // Discord gateway/history lines: "a message in <guild>/<#channel>" or "a message in <snowflake>"
    s = s.replace(
      /(\ba message in\s+)(\d{15,22})\b/gi,
      (_m, pre: string, cid: string) => `${pre}${this.tag('channel', cid)}`
    )
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
        const tagKind: AnonymizerTagKind =
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

    // Discord GoLive / stream_key tuples:
    //   guild:12345678901234567:1574512928730783895:1105651912457605170
    //   guild:guild#16:1574512928730783895:1105651912457605170
    //   call:1574512928730783895:1105651912457605170
    s = s.replace(
      /\bguild:(guild#\d+|\d{15,22}):(\d{15,22}):(\d{15,22})\b/g,
      (_m, g: string, c: string, u: string) =>
        `guild:${this.tag('guild', g)}:${this.tag('channel', c)}:${this.tag('user', u)}`
    )
    s = s.replace(
      /\bcall:(\d{15,22}):(\d{15,22})\b/g,
      (_m, c: string, u: string) => `call:${this.tag('channel', c)}:${this.tag('user', u)}`
    )

    // Discord voice/stream snowflake & relay references:
    //   discord voice: stream 17304 is user 1015961801306935427
    //   owned by 1105651912457605170
    //   for channel 1574560562497593413
    //   identifying to c-iad20-8687d324.discord.media:443 as server 1574560562497593414
    //   watching guild:guild#16:channel#2:user#24 on c-iad20-8687d324.discord.media:443 via rtc channel 1574560562497593413
    s = s.replace(
      /(\bstream\s+\d+\s+is user\s+)(\d{15,22})\b/gi,
      (_m, pre: string, uid: string) => `${pre}${this.tag('user', uid)}`
    )
    s = s.replace(
      /(\bowned by\s+)(\d{15,22})\b/gi,
      (_m, pre: string, uid: string) => `${pre}${this.tag('user', uid)}`
    )
    s = s.replace(
      /(\b(?:for|via rtc)\s+channel\s+)(\d{15,22})\b/gi,
      (_m, pre: string, cid: string) => `${pre}${this.tag('channel', cid)}`
    )
    s = s.replace(
      /(\bas server\s+)(\d{15,22})\b/gi,
      (_m, pre: string, sid: string) => `${pre}${this.tag('server', sid)}`
    )
    s = s.replace(
      /(\b(?:identifying to|on)\s+)([A-Za-z0-9.-]+\.discord\.media)(:\d+)?\b/gi,
      (_m, pre: string, host: string, port?: string) => `${pre}${this.tag('server', host)}${port ?? ''}`
    )

    // Discord golive/voice ids: guild:12345678901234567, channel:12345678901234567
    s = s.replace(
      /\b(guild|channel|room|user):([0-9]{6,22})\b/gi,
      (_m, kind: string, id: string) => {
        const k = kind.toLowerCase() as AnonymizerTagKind
        return `${k}:${this.tag(k, id)}`
      }
    )

    // JSON snowflake ID arrays in GoLive / streamconn payloads (viewer_ids, user_ids),
    // including lines truncated mid-element before the closing `"` or `]`.
    s = s.replace(
      /"(viewer_ids|user_ids)"\s*:\s*\[([^\]]*)(\]?)/g,
      (_m, field: string, body: string, close: string) => {
        const scrubbed = body
          .replace(/"(\d{15,22})"/g, (_im, id: string) => `"${this.tag('user', id)}"`)
          .replace(/"\d+(…|\.\.\.|$)/g, (_im, tail: string) => `"[truncated]${tail}`)
        return `"${field}":[${scrubbed}${close}`
      }
    )

    // JSON voice/stream relay endpoints: "endpoint":"c-iad20-8687d324.discord.media:443"
    s = s.replace(
      /"endpoint"\s*:\s*"([A-Za-z0-9.-]+\.[A-Za-z]{2,}(?::\d+)?)"/g,
      (_m, ep: string) => {
        const [host, port] = ep.split(':')
        return `"endpoint":"${this.tag('server', host)}${port ? `:${port}` : ''}"`
      }
    )

    // JSON snowflake IDs in unhandled gateway / GoLive payloads (including truncated tails)
    s = s.replace(
      /"(guild_id|channel_id|rtc_channel_id|rtc_server_id|user_id|author_id|id)"\s*:\s*"(\d{15,22})"/g,
      (_m, field: string, id: string) => {
        const kind: AnonymizerTagKind =
          field === 'guild_id'
            ? 'guild'
            : field === 'rtc_server_id'
              ? 'server'
              : field === 'user_id' || field === 'author_id'
                ? 'user'
                : 'channel'
        return `"${field}":"${this.tag(kind, id)}"`
      }
    )
    s = s.replace(
      /"(guild_id|channel_id|rtc_channel_id|rtc_server_id|user_id|author_id|id)"\s*:\s*"\d+(…|\.\.\.|$)/g,
      (_m, field: string, tail: string) => `"${field}":"[truncated]${tail}`
    )

    // Sneedchat user UUIDs, file UUIDs & numeric attachment IDs
    s = s.replace(
      /(\bavatar fetch for user\s+)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi,
      (_m, pre: string, uuid: string) => `${pre}${this.tag('user', uuid)}`
    )
    s = s.replace(
      /(sneedchat-avatars\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
      (_m, pre: string, uuid: string) => `${pre}${this.tag('user', uuid)}`
    )
    s = s.replace(
      /(\b(?:fetching\s+)?file\s+)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi,
      (_m, pre: string, uuid: string) => `${pre}${this.tag('file', uuid)}`
    )
    s = s.replace(
      /(\battachment\s+)(\d{5,22})\b/gi,
      (_m, pre: string, id: string) => `${pre}${this.tag('file', id)}`
    )

    // Telegram media cache filenames: telegram-media/tg_<uid>_n<chat>_<msg>_thumb.jpg
    s = s.replace(
      /(telegram-media\/)tg_(\d+)_(n?\d+)_(\d+)/gi,
      (_m, pre: string, uid: string, cid: string, mid: string) =>
        `${pre}tg_${this.tag('user', uid)}_${this.tag('channel', cid)}_${this.tag('file', mid)}`
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

    // HTTP(S) / WS(S) URLs: anonymize non-documentation hosts, file IDs, and sensitive query params
    s = s.replace(
      /((?:https?|wss?):\/\/)([^/\s)"':]+)(:\d+)?([^\s)"']*)/gi,
      (_m, scheme: string, host: string, port: string | undefined, rest: string) => {
        const lowerHost = host.toLowerCase()
        if (SAFE_DOC_HOSTS.has(lowerHost) || lowerHost === '127.0.0.1' || lowerHost === 'localhost') {
          return `${scheme}${host}${port ?? ''}${rest}`
        }
        let scrubbedHost: string
        if (/^server#\d+(?:\.onion)?$/i.test(host)) {
          scrubbedHost = host
        } else if (lowerHost.endsWith('.onion')) {
          scrubbedHost = `${this.tag('server', lowerHost)}.onion`
        } else {
          scrubbedHost = this.tag('server', host)
        }
        let scrubbedRest = rest
        scrubbedRest = scrubbedRest.replace(
          /(\/chat\/files\/)([^/?#\s]+)/gi,
          (_fm, pre: string, fid: string) => `${pre}${this.tag('file', fid)}`
        )
        scrubbedRest = scrubbedRest.replace(
          /(\/attachments\/)([^/?#\s]+)/gi,
          (_am, pre: string, aid: string) => `${pre}${this.tag('file', aid)}`
        )
        scrubbedRest = scrubbedRest.replace(
          /([?&](?:t|token|access_token|refresh_token|auth|sig|signature|key|secret|code|ticket|since|session|session_id|cookie|password|dpl)=)([^&#\s)"']+)/gi,
          '$1[removed]'
        )
        return `${scheme}${scrubbedHost}${port ?? ''}${scrubbedRest}`
      }
    )

    // Steam relay prefix: `steam[user#1]: cmp2-iad1.steamserver.net:443: ...` or `not connected (cmp2-...:443:`
    s = s.replace(
      /(\bsteam\[[^\]]+\]:\s+(?:not connected \()?)([a-z0-9-]+(?:\.[a-z0-9-]+)+\.[a-z]{2,})(:\d+)?(?=:)/gi,
      (_m, pre: string, host: string, port?: string) => `${pre}${this.tag('server', host)}${port ?? ''}`
    )

    // XMPP client resource suffixes: `/moho.777en9sj` -> `/moho.[resource]`
    s = s.replace(/(\/moho\.)([A-Za-z0-9_-]{4,})\b/g, '$1[resource]')

    // IRC / XMPP / Tor connection hosts:
    //   `Connecting via TLS to irc.libera.chat.`
    //   `reached xmpp.example.org:5222 (STARTTLS)`
    //   `Tor could not reach uploads.example.org:443`
    //   `timed out connecting to irc.example.org:6697`
    s = s.replace(
      /(\b(?:Connecting(?:\s+via\s+\S+)?\s+to|could not reach|reached)\s+)([A-Za-z0-9.-]+\.[A-Za-z]{2,})(:\d+)?(\.?)/gi,
      (_m, pre: string, host: string, port: string | undefined, dot: string) =>
        host.toLowerCase().endsWith('.onion')
          ? `${pre}${this.tag('server', host)}.onion${port ?? ''}${dot}`
          : `${pre}${this.tag('server', host)}${port ?? ''}${dot}`
    )

    // XMPP DNS line (may list multiple SRV targets): `DNS says a.tld:5223 (TLS), b.tld:5222`
    s = s.replace(/\bDNS says\s+[^\n]+/gi, (clause) =>
      clause.replace(
        /\b([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})(:\d+)?\b/g,
        (m, host: string, port?: string) => {
          if (/^server#\d+$/i.test(host)) return m
          return `${this.tag('server', host)}${port ?? ''}`
        }
      )
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

    // Pre-seeded known account/user/server/guild/channel/room names caught anywhere free-form.
    for (const kp of this.knownPatterns) {
      kp.re.lastIndex = 0
      s = s.replace(kp.re, () => this.tag(kp.kind, kp.raw))
    }

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

    // Truncated onion tails printed by Tor/Arti: `[…]cyd.onion` -> `[scrubbed].onion`
    s = s.replace(/(?:\[…\]|\[\.\.\.\])[a-z2-7]{1,16}\.onion\b/gi, '[scrubbed].onion')

    // Onion addresses (including subdomains like uploads.<56chars>.onion)
    s = s.replace(
      /\b((?:[a-z0-9-]+\.)*[a-z2-7]{16,56})\.onion\b/gi,
      (_m, addr: string) => `${this.tag('server', `${addr.toLowerCase()}.onion`)}.onion`
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

const ISO_TS_PREFIX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+(.*)$/
const LEVEL_PREFIX = /^(info|warn|error|debug|trace)\s+(.*)$/

interface LogEntry {
  lines: string[]
  timestamp: string | null
  tsMs: number | null
  level: string | null
  body: string
}

function parseEntry(lines: string[]): LogEntry {
  const first = lines[0] ?? ''
  const tsMatch = first.match(ISO_TS_PREFIX)
  if (!tsMatch) {
    return { lines, timestamp: null, tsMs: null, level: null, body: first }
  }
  const timestamp = tsMatch[1]
  const parsedMs = Date.parse(timestamp)
  const tsMs = Number.isFinite(parsedMs) ? parsedMs : null
  const lvlMatch = tsMatch[2].match(LEVEL_PREFIX)
  if (!lvlMatch) {
    return { lines, timestamp, tsMs, level: null, body: tsMatch[2] }
  }
  return { lines, timestamp, tsMs, level: lvlMatch[1], body: lvlMatch[2] }
}

/**
 * Groups continuation lines (such as multi-line JS/Rust stack traces without a
 * leading ISO timestamp) onto their preceding timestamped entry so reversing
 * newest-to-oldest never scrambles a stack trace.
 */
function groupLogEntries(lines: string[]): LogEntry[] {
  const groups: string[][] = []
  let prevHasTs = false
  for (const line of lines) {
    const hasTs = ISO_TS_PREFIX.test(line)
    if (!hasTs && prevHasTs && groups.length > 0) {
      groups[groups.length - 1].push(line)
    } else {
      groups.push([line])
      prevHasTs = hasTs
    }
  }
  return groups.map(parseEntry)
}

function shortClock(ts: string): string {
  const t = ts.indexOf('T')
  if (t < 0) return ts
  return ts.slice(t + 1, t + 9) + 'Z'
}

/**
 * Lifecycle and diagnostic lines that should never be burst-compacted even if
 * they happen to appear repeatedly.
 */
const PROTECTED_INFO_RE =
  /^(?:moho starting|moho quitting|tunnel:|\[call\]|\[screenshare\]|\[signal-calls\]|\[nobilis\] (?:exited|adopting|rpc link|nobilis::runtime:|nobilis::rpc:|nobilis::net::webhelper:))|\b(?:connected|disconnected|signed in|resumed|ready as|listening on)\b/i

function infoTemplateKey(body: string): string | null {
  if (PROTECTED_INFO_RE.test(body)) return null
  let key = body
  // Collapse high-volume Discord gateway / GoLive / streamconn chatter
  key = key.replace(/(the last minute, by kind:).*$/, '$1 ...')
  key = key.replace(/(STREAM_UPDATE)\s+\{.*\}$/, '$1 {...}')
  key = key.replace(/(VOICE_CHANNEL_START_TIME_UPDATE \(not handled here\))\s+\{.*\}$/, '$1 {...}')
  key = key.replace(/(DAVE in: op \d+)\s+\(\d+ bytes\)/, '$1 (<n> bytes)')
  key = key.replace(/(\bdatagram )\d+( on guild:(?:guild#\d+|\d+):(?:channel#\d+|\d+):(?:user#\d+|\d+): ).*$/, '$1<n>$2...')
  key = key.replace(/(discord voice: stream )\d+( is user )/, '$1<ssrc>$2')
  // Normalize placeholders, media hashes, and durations
  key = key.replace(/\b(user|server|guild|channel|room|account|ip|file)#\d+\b/g, '<$1>')
  key = key.replace(/\b[0-9a-f]{12,}\b/gi, '<hash>')
  key = key.replace(/\b\d+ms\b/g, '<ms>')
  key = key.replace(/\b\d+ row\(s\)|\b\d+ page\(s\)/g, '<n> item(s)')
  return key
}

function warnErrorTemplateKey(body: string): string {
  // Group interleaved renderer CSP asset errors on the same host & directive
  if (body.startsWith('[renderer] Loading the ')) {
    return body.replace(/'https?:\/\/(server#\d+)[^']*'/g, "'https://$1/<asset>'")
  }
  // Normalize consecutive repeat suffixes from Pass 1 so interleaved clusters merge cleanly
  return body.replace(/\s+\(×\d+(?:, [^)]+)?\)$/, '')
}

const BURST_WINDOW_MS = 60 * 60 * 1000
const INFO_BURST_THRESHOLD = 5
const WARN_BURST_THRESHOLD = 4
const BURST_KEEP_FIRST = 1
const BURST_KEEP_LAST = 2

/**
 * Collapses noisy repeats while preserving all diagnostic signal:
 * 1. Exact consecutive duplicates (any level, ignoring timestamp) collapse to
 *    one line with `(×N)`.
 * 2. High-volume repetitive `info` templates (> 5 occurrences in a 60-minute
 *    session window) keep the first 1 and last 2 verbatim and summarize the
 *    middle with one `[export] collapsed N× ...` line.
 * 3. Interleaved repeated `warn`/`error` entries (> 4 occurrences in a 60-minute
 *    session window) keep the first 2 and last 2 verbatim and summarize the
 *    middle at the same severity (`warn`/`error`) so grep and error counts stay
 *    intact. Lifecycle events and multi-line stack traces are never compacted.
 */
function compactEntries(entries: LogEntry[]): { entries: LogEntry[]; linesCollapsed: number } {
  let linesCollapsed = 0

  // Pass 1: exact consecutive duplicate collapse (single-line entries only)
  const deduped: LogEntry[] = []
  let i = 0
  while (i < entries.length) {
    const cur = entries[i]
    if (cur.lines.length > 1 || !cur.timestamp) {
      deduped.push(cur)
      i++
      continue
    }
    let j = i + 1
    while (
      j < entries.length &&
      entries[j].lines.length === 1 &&
      entries[j].timestamp !== null &&
      entries[j].level === cur.level &&
      entries[j].body === cur.body
    ) {
      j++
    }
    const count = j - i
    if (count === 1) {
      deduped.push(cur)
    } else {
      const last = entries[j - 1]
      const span =
        cur.tsMs !== null && last.tsMs !== null && last.tsMs - cur.tsMs >= 1000
          ? `, ${shortClock(cur.timestamp)}..${shortClock(last.timestamp!)}`
          : ''
      const collapsedLine = `${last.lines[0]} (×${count}${span})`
      deduped.push({ ...last, lines: [collapsedLine] })
      linesCollapsed += count - 1
    }
    i = j
  }

  // Pass 2: hourly session-windowed compaction for repetitive `info` bursts
  // and interleaved repeated `warn`/`error` loops.
  let session = 0
  const buckets = new Map<
    string,
    { level: 'info' | 'warn' | 'error'; tpl: string; idxs: number[] }
  >()

  for (let idx = 0; idx < deduped.length; idx++) {
    const e = deduped[idx]
    if (e.body.startsWith('moho starting')) {
      session++
      continue
    }
    if (e.lines.length > 1 || e.tsMs === null) continue
    if (e.level !== 'info' && e.level !== 'warn' && e.level !== 'error') continue

    const tpl = e.level === 'info' ? infoTemplateKey(e.body) : warnErrorTemplateKey(e.body)
    if (!tpl) continue
    const win = Math.floor(e.tsMs / BURST_WINDOW_MS)
    const bKey = `${session}|${win}|${e.level}|${tpl}`
    let bucket = buckets.get(bKey)
    if (!bucket) {
      bucket = { level: e.level, tpl, idxs: [] }
      buckets.set(bKey, bucket)
    }
    bucket.idxs.push(idx)
  }

  const dropSet = new Set<number>()
  const summaryAt = new Map<number, LogEntry>()

  for (const bucket of buckets.values()) {
    const isInfo = bucket.level === 'info'
    const threshold = isInfo ? INFO_BURST_THRESHOLD : WARN_BURST_THRESHOLD
    const keepFirst = isInfo ? BURST_KEEP_FIRST : 2
    const keepLast = BURST_KEEP_LAST
    if (bucket.idxs.length <= threshold) continue
    const middle = bucket.idxs.slice(keepFirst, bucket.idxs.length - keepLast)
    if (middle.length < 2) continue
    for (const mIdx of middle) dropSet.add(mIdx)
    const firstMid = deduped[middle[0]]
    const lastMid = deduped[middle[middle.length - 1]]
    const shortTpl = bucket.tpl.length > 120 ? `${bucket.tpl.slice(0, 117)}...` : bucket.tpl
    const span =
      firstMid.timestamp && lastMid.timestamp
        ? ` (${shortClock(firstMid.timestamp)}..${shortClock(lastMid.timestamp)})`
        : ''
    const kindLabel = isInfo ? 'similar lines' : `repeated ${bucket.level}s`
    const summaryLine = `${lastMid.timestamp} ${bucket.level} [export] collapsed ${middle.length.toLocaleString('en-US')}× ${kindLabel}: ${shortTpl}${span}`
    summaryAt.set(middle[middle.length - 1], parseEntry([summaryLine]))
    linesCollapsed += middle.length - 1
  }

  const out: LogEntry[] = []
  for (let idx = 0; idx < deduped.length; idx++) {
    const summary = summaryAt.get(idx)
    if (summary) out.push(summary)
    if (!dropSet.has(idx)) out.push(deduped[idx])
  }

  return { entries: out, linesCollapsed }
}

export function formatHeader(
  header: LogExportHeader,
  linesOmitted: number,
  linesCollapsed = 0
): string {
  const omittedNote =
    linesOmitted > 0
      ? `${linesOmitted.toLocaleString('en-US')} (oldest lines dropped to fit size limit)`
      : '0 (whole log)'
  const lines = [
    '=== moho log export ===',
    `moho: ${header.mohoVersion} (${header.mohoBuild})`,
    `nobilis: ${header.nobilisVersion} (${header.nobilisBuild})`
  ]
  if (header.electronVersion || header.chromeVersion) {
    const parts = [
      header.electronVersion ? `Electron ${header.electronVersion}` : null,
      header.chromeVersion ? `Chromium ${header.chromeVersion}` : null
    ].filter(Boolean)
    lines.push(`runtime: ${parts.join(' / ')}`)
  }
  lines.push(`os: ${header.osType} ${header.osVersion} (${header.osArch})`)
  const envParts = [
    header.displayServer ? `display=${header.displayServer}` : null,
    header.packaging ? `packaging=${header.packaging}` : null,
    header.sandboxed !== undefined ? `sandbox=${header.sandboxed ? 'on' : 'off'}` : null
  ].filter(Boolean)
  if (envParts.length > 0) lines.push(`env: ${envParts.join(', ')}`)
  if (header.tunnel) lines.push(`tunnel: ${header.tunnel}`)
  if (header.backends) lines.push(`backends: ${header.backends}`)
  lines.push(`exported: ${header.exportedAt}`)
  lines.push('order: newest first')
  if (linesCollapsed > 0) {
    lines.push(`lines collapsed: ${linesCollapsed.toLocaleString('en-US')} (repeated noise)`)
  }
  lines.push(`lines omitted: ${omittedNote}`)
  lines.push('=======================')
  lines.push('')
  return lines.join('\n')
}

/**
 * Normalizes, anonymizes, deduplicates/compacts noisy repeats, trims oldest
 * entries first when `maxBytes` is set, and outputs entries newest-to-oldest
 * beneath the always-kept header.
 */
export function buildLogExport(
  rawLines: string[],
  header: LogExportHeader,
  options?: { maxBytes?: number; anonymizer?: Anonymizer }
): LogExportResult {
  const anonymizer = options?.anonymizer ?? new Anonymizer()
  const totalLines = rawLines.length
  const anonLines = rawLines.map((l) => anonymizer.line(normalizeLogLine(l)))
  const rawEntries = groupLogEntries(anonLines)
  const { entries, linesCollapsed } = compactEntries(rawEntries)
  const maxBytes = options?.maxBytes

  const entryTexts = entries.map((e) => e.lines.join('\n'))
  const entryLineCounts = entries.map((e) => e.lines.length)

  if (!maxBytes) {
    const ordered = [...entryTexts].reverse()
    const body = ordered.length ? ordered.join('\n') + '\n' : ''
    const text = formatHeader(header, 0, linesCollapsed) + body
    return {
      text,
      sizeBytes: Buffer.byteLength(text, 'utf8'),
      linesOmitted: 0,
      linesCollapsed,
      totalLines
    }
  }

  // First check if the whole compacted log already fits.
  const fullHeader = formatHeader(header, 0, linesCollapsed)
  const fullHeaderBytes = Buffer.byteLength(fullHeader, 'utf8')
  const entryBytes = entryTexts.map((t) => Buffer.byteLength(t, 'utf8') + 1) // +1 for '\n'
  let bodyBytes = 0
  for (const b of entryBytes) bodyBytes += b

  if (fullHeaderBytes + bodyBytes <= maxBytes) {
    const ordered = [...entryTexts].reverse()
    const body = ordered.length ? ordered.join('\n') + '\n' : ''
    const text = fullHeader + body
    return {
      text,
      sizeBytes: Buffer.byteLength(text, 'utf8'),
      linesOmitted: 0,
      linesCollapsed,
      totalLines
    }
  }

  // Drop oldest entries from index 0 upward until header(omitted) + remaining fits.
  let omittedEntries = 0
  let omittedLines = 0
  while (omittedEntries < entryTexts.length) {
    bodyBytes -= entryBytes[omittedEntries]
    omittedLines += entryLineCounts[omittedEntries]
    omittedEntries++
    const h = formatHeader(header, omittedLines, linesCollapsed)
    if (Buffer.byteLength(h, 'utf8') + bodyBytes <= maxBytes) {
      const kept = entryTexts.slice(omittedEntries).reverse()
      const body = kept.length ? kept.join('\n') + '\n' : ''
      const text = h + body
      return {
        text,
        sizeBytes: Buffer.byteLength(text, 'utf8'),
        linesOmitted: omittedLines,
        linesCollapsed,
        totalLines
      }
    }
  }

  // Even 0 entries exceeded maxBytes (only possible with a tiny test cap): keep header only.
  const h = formatHeader(header, omittedLines, linesCollapsed)
  return {
    text: h,
    sizeBytes: Buffer.byteLength(h, 'utf8'),
    linesOmitted: omittedLines,
    linesCollapsed,
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
