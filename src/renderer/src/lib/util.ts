import discordSvg from '../assets/discord.svg'
import sneedchatMark from '../assets/sneedchat.png'
import matrixSvg from '../assets/matrix.svg'

/**
 * Discord channel buffers are named "GuildName/#channel" internally - that's
 * what keeps two guilds' same-named channels from colliding into one buffer id.
 * Everywhere outside the sidebar's own guild-grouped rows, show just the
 * "#channel" part. No other buffer kind's name contains "/", so this is a safe
 * no-op for IRC, Matrix and Sneedchat.
 */
export function bufferDisplayName(name: string): string {
  const idx = name.lastIndexOf('/')
  return idx === -1 ? name : name.slice(idx + 1)
}

/** The guild half of a Discord buffer name, or "" for anything else. */
export function guildOf(name: string): string {
  const idx = name.lastIndexOf('/')
  return idx === -1 ? '' : name.slice(0, idx)
}

/**
 * Real brand marks where one exists, otherwise the closest Material Symbol:
 * "tag" for IRC matches its literal "#" channel prefix, "workspaces" echoes
 * Slack's own term for a team, "forum" is the closest generic stand-in for
 * XMPP (which has no widely recognised mark), and "vpn_lock" evokes the
 * Tor-only transport Sneedchat runs over.
 */
/**
 * A service's brand mark.
 *
 * `mark` is artwork whose *alpha* is the silhouette, so it works as a CSS mask
 * regardless of being an SVG or a PNG - which is what lets these sit quietly in
 * a list, painted in the surrounding text colour like any other icon.
 *
 * `colour` says the artwork's own colours are worth keeping where there is
 * room for them - the rail, where it sits beside full-colour guild icons -
 * while the same file still masks down to a monochrome glyph in the compact
 * places.
 */
export interface ServiceIcon {
  mark?: string
  colour?: boolean
  glyph?: string
}

export function serviceIcon(service: string): ServiceIcon {
  switch (service) {
    case 'discord':
      return { mark: discordSvg }
    case 'matrix':
      return { mark: matrixSvg }
    case 'irc':
      return { glyph: 'tag' }
    case 'slack':
      return { glyph: 'workspaces' }
    case 'jabber':
    case 'xmpp':
      return { glyph: 'forum' }
    case 'sockchat':
      return { mark: sneedchatMark, colour: true }
    default:
      return { glyph: 'chat' }
  }
}

export function serviceLabel(service: string): string {
  switch (service) {
    case 'irc':
      return 'IRC'
    case 'discord':
      return 'Discord'
    case 'matrix':
      return 'Matrix'
    case 'sockchat':
      return 'Sneedchat'
    case 'slack':
      return 'Slack'
    case 'jabber':
    case 'xmpp':
      return 'XMPP'
    default:
      return service
  }
}

/**
 * Whether a message kind represents something a person actually said, as
 * opposed to a log line (a join, a topic change, a server notice).
 *
 * The backends disagree on the label: IRC, Discord and Sneedchat record an
 * ordinary message as "chat", Matrix as "message". Both mean the same thing,
 * and treating Matrix's as anything else renders every Matrix message as a
 * grey system line with no author or avatar.
 */
export function isChatKind(kind: string | undefined): boolean {
  return kind === 'chat' || kind === 'message'
}

export function bufferKindGlyph(kind: string): string {
  if (kind === 'server') return 'dns'
  if (kind === 'dm') return 'alternate_email'
  return 'tag'
}

/**
 * Deterministic per-nick colour, so the same person keeps the same colour
 * across sessions and buffers. Hue-only variation against a fixed saturation
 * and lightness keeps every result legible on the dark surface.
 */
export function nickColor(nick: string): string {
  let hash = 0
  for (let i = 0; i < nick.length; i++) hash = (hash * 31 + nick.charCodeAt(i)) | 0
  return `hsl(${Math.abs(hash) % 360}, 62%, 68%)`
}

/**
 * nobilis hands back local file:// paths for media it fetched on our behalf
 * (Tor-routed Sneedchat avatars/attachments, Matrix media, the Discord QR).
 * The renderer can't load file:// under contextIsolation, so route those
 * through main's guarded moho-media scheme instead. Remote http(s) URLs and
 * anything else are left alone.
 */
export function resolveMediaUrl(url: string): string {
  if (!url) return url
  let path: string | null = null
  if (url.startsWith('file://')) {
    path = decodeURI(url.slice('file://'.length))
    // Some producers write file:///C:/x and some write file://C:\x. Both mean
    // the same file; the leading slash is part of the URL form, not the path,
    // and left on it Windows reads it as a path relative to the current drive.
    if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1)
  } else if (url.startsWith('/') || /^[A-Za-z]:[\\/]/.test(url)) {
    // Absolute means "starts at a root", and a Windows root is a drive letter
    // rather than a slash. Without the second test a bare C:\... path fell
    // through as if it were a remote URL and was handed to the renderer
    // unresolved, which under contextIsolation simply shows nothing.
    path = url
  }
  if (path === null) return url

  // The path travels as a query parameter, not as the URL path. moho-media is
  // registered as a "standard" scheme (needed for fetch and streaming), and
  // Chromium parses `scheme:///abs/path` by consuming the first path segment
  // as the hostname - so a src of moho-media:///1tb/x.png arrives at the
  // handler as host "1tb" with path "/x.png". A query parameter is opaque to
  // that normalisation, and also can't be twisted by `..` segments.
  return `${MEDIA_SCHEME}://file/?p=${encodeURIComponent(path)}`
}

export const MEDIA_SCHEME = 'moho-media'

export function formatTime(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function formatFullTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString([], {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * "8m ago" style, switching to "Yesterday at 5:27 PM" past 23h and a short
 * date past 47h - the thresholds the original used, chosen so "yesterday"
 * never shows for something that happened earlier today.
 */
export function formatRelativeTime(ts: number, now = Date.now()): string {
  const secs = Math.max(0, Math.floor(now / 1000) - ts)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 23 * 3600) return `${Math.floor(secs / 3600)}h ago`
  const d = new Date(ts * 1000)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (secs < 47 * 3600) return `Yesterday at ${time}`
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${time}`
}

export function classes(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
