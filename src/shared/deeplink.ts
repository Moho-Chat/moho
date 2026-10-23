/**
 * Links that name a place to chat, as a browser hands them over.
 *
 * `irc://irc.coreirc.net/elitewarez` is the shape people paste on forums and
 * put behind "join us on IRC" buttons, and it has meant the same thing since
 * long before this client existed: a host, optionally a port, and optionally a
 * channel to join once connected.
 *
 * Shared between the main process and the renderer rather than living in
 * either. Main needs to recognise one to know an argument is a link at all;
 * the renderer needs to take it apart. Two readings of the same string that
 * could drift apart is how a link opens the wrong network.
 */

export interface IrcLink {
  service: 'irc'
  host: string
  port?: number
  tls: boolean
  /** Channels to join, `#` included, in the order they were listed. */
  channels: string[]
}

/** A Kick channel, named by the handle in a kick.com link. */
export interface KickLink {
  service: 'kick'
  handle: string
}

/**
 * A link to a Telegram chat or a post in one, as a `tg://` link (what the "View in Telegram" button on a web preview
 * opens) or a t.me address in a message. The daemon reads it: this only recognises one, and passes it on whole.
 */
export interface TelegramLink {
  service: 'telegram'
  url: string
}

export type DeepLink = IrcLink | KickLink | TelegramLink

/**
 * Schemes moho asks the desktop to send it.
 *
 * Deliberately not the same list as what `isDeepLink` accepts: a kick.com
 * link is an ordinary web address, and registering for `https` would mean
 * volunteering to be the system browser.
 */
export const DEEP_LINK_SCHEMES = ['irc', 'ircs', 'tg']

/** Whether a string is a link this client would act on. */
export function isDeepLink(value: string): boolean {
  const lower = value.toLowerCase()
  return DEEP_LINK_SCHEMES.some((s) => lower.startsWith(`${s}:`)) ? isTelegramOrIrc(value) : !!kickHandle(value) || isTelegramLink(value)
}

/** A `tg:` link is only one of ours if it is a kind that opens a chat; the others (login, proxy, themes) are not. */
function isTelegramOrIrc(value: string): boolean {
  return value.toLowerCase().startsWith('tg:') ? isTelegramLink(value) : true
}

/** Pages on t.me that are about something other than a chat. */
const TELEGRAM_PAGES = ['s', 'addstickers', 'addemoji', 'setlanguage', 'proxy', 'socks', 'share', 'login', 'iv', 'addtheme', 'bg', 'boost', 'm', 'addlist', 'invoice', 'giftcode', 'contact']

/**
 * Whether a string is a link to a Telegram chat, a post, or a private invite: `tg://resolve`, `tg://privatepost`,
 * `tg://join`, and t.me, telegram.me and telegram.dog addresses that name one. The same reading the daemon makes
 * (nobilis backend/telegram/links.rs), which has the last word.
 */
export function isTelegramLink(value: string): boolean {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return false
  }
  if (url.protocol === 'tg:') {
    const params = url.searchParams
    if (url.hostname === 'resolve') {
      const domain = params.get('domain') ?? ''
      return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(domain) && domain !== 'telegrampassport'
    }
    if (url.hostname === 'privatepost') return /^\d+$/.test(params.get('channel') ?? '')
    if (url.hostname === 'join') return /^[A-Za-z0-9_-]+$/.test(params.get('invite') ?? '')
    return false
  }
  if (!/^https?:$/.test(url.protocol)) return false
  if (!['t.me', 'telegram.me', 'telegram.dog'].includes(url.hostname.replace(/^www\./, ''))) return false
  const parts = url.pathname.split('/').filter(Boolean)
  const first = parts[0]
  if (!first) return false
  if (first.startsWith('+')) return /^[A-Za-z0-9_-]+$/.test(first.slice(1))
  if (first === 'joinchat') return /^[A-Za-z0-9_-]+$/.test(parts[1] ?? '')
  if (first === 'c') return /^\d+$/.test(parts[1] ?? '')
  if (TELEGRAM_PAGES.includes(first)) return false
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(first)
}

/**
 * The handle in a kick.com link, if it is one that names a channel.
 *
 * Only the bare `kick.com/<handle>` form. A link to a clip, a video or a
 * category is a page moho cannot show, and opening the channel instead would
 * quietly take somebody somewhere they did not ask to go - those keep going
 * to the browser.
 */
export function kickHandle(value: string): string | null {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (!/^https?:$/.test(url.protocol)) return null
  if (url.hostname.replace(/^www\./, '').toLowerCase() !== 'kick.com') return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 1) return null
  const handle = parts[0]
  return /^[A-Za-z0-9_-]+$/.test(handle) ? handle : null
}

/**
 * Takes an `irc://` or `ircs://` link apart, or returns null if it is not one.
 *
 * Written against what is actually in the wild rather than against a
 * specification, because the two never fully agreed and the drafts expired
 * twenty years ago:
 *
 * - The channel comes after the host with its `#` usually dropped, since a
 *   bare `#` in a URL starts a fragment. It may also arrive percent-encoded,
 *   or doubled as `##` for a network-wide channel, and both must survive.
 * - Several channels can be listed, comma-separated.
 * - A comma can also carry a flag rather than another channel - `needkey`,
 *   `isnick` and the rest of a small fixed set from the expired drafts. Those
 *   are dropped, and anything else after a comma is taken as another channel,
 *   which is what the ones people actually write turn out to be.
 * - A key can arrive as `?key=`. It is not kept: it would have to be stored,
 *   and a password out of a link anybody could have posted is not a thing to
 *   put on disk.
 * - `ircs://` means TLS. `irc://` on port 6697 does too, whatever it says,
 *   because that port is TLS everywhere and a link that names it means it.
 */
export function parseDeepLink(value: string): DeepLink | null {
  const kick = kickHandle(value)
  if (kick) return { service: 'kick', handle: kick }
  if (isTelegramLink(value)) return { service: 'telegram', url: value.trim() }

  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }

  const scheme = url.protocol.replace(/:$/, '').toLowerCase()
  if (scheme !== 'irc' && scheme !== 'ircs') return null
  const host = url.hostname
  if (!host) return null

  const port = url.port ? Number(url.port) : undefined
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) return null

  // The fragment is part of the channel, not a fragment: a browser splits
  // `irc://host/#chan` there, and putting it back is what makes the ordinary
  // written form work.
  const rest = `${url.pathname}${url.hash}`.replace(/^\/+/, '')

  return {
    service: 'irc',
    host,
    port,
    tls: scheme === 'ircs' || port === 6697,
    channels: parseChannels(rest)
  }
}

/**
 * Words that can follow a comma without being another channel.
 *
 * From the drafts that never became a standard, which is also why the list is
 * short and fixed: these are the only ones anything in the wild emits.
 */
const FLAGS = ['isnick', 'isserver', 'ischannel', 'needkey', 'needpass', 'nokey', 'nopass']

function parseChannels(rest: string): string[] {
  if (!rest) return []
  let decoded = rest
  try {
    decoded = decodeURIComponent(rest)
  } catch {
    // A malformed escape is not worth refusing the whole link over; the raw
    // text is still a usable channel name far more often than not.
  }

  const out: string[] = []
  for (const part of decoded.split(',')) {
    const name = part.trim()
    if (!name) continue
    if (FLAGS.includes(name.toLowerCase())) continue
    const channel = name.startsWith('#') || name.startsWith('&') ? name : `#${name}`
    // A channel name cannot hold these, so a link containing one is malformed
    // or trying something.
    if (/[\s,]/.test(channel)) continue
    if (!out.includes(channel)) out.push(channel)
  }
  return out
}
