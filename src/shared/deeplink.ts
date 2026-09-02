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

export type DeepLink = IrcLink | KickLink

/**
 * Schemes moho asks the desktop to send it.
 *
 * Deliberately not the same list as what `isDeepLink` accepts: a kick.com
 * link is an ordinary web address, and registering for `https` would mean
 * volunteering to be the system browser.
 */
export const DEEP_LINK_SCHEMES = ['irc', 'ircs']

/** Whether a string is a link this client would act on. */
export function isDeepLink(value: string): boolean {
  const lower = value.toLowerCase()
  return DEEP_LINK_SCHEMES.some((s) => lower.startsWith(`${s}:`)) || !!kickHandle(value)
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

  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }

  const scheme = url.protocol.replace(/:$/, '').toLowerCase()
  if (!DEEP_LINK_SCHEMES.includes(scheme)) return null
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
