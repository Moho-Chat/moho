import type { SockchatSmilie } from '../../../shared/wire'

/**
 * Message body formatting, ported from the QML frontend's MessageList.
 *
 * The pipeline produces a restricted HTML string, exactly as the original did.
 * Unlike Qt's StyledText (a script-free rich-text subset), a browser would
 * happily execute whatever that string contains, so the output is never
 * injected directly - richtext.tsx parses it and walks it through a
 * tag/attribute whitelist into React nodes. Formatting semantics are the
 * original's; the sanitisation boundary is new.
 */

export interface MediaItem {
  url: string
  kind: 'image' | 'video' | 'youtube'
  youtubeId?: string
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Sneedchat messages carry BBCode - the site's own greentext is literally
 * `[color=#72ff72]>text`. Rather than a separate protocol-gated formatter,
 * this normalises BBCode into the conventions the rest of the pipeline already
 * understands. IRC/Discord/Matrix bodies never contain these tags, so it's a
 * safe no-op for them.
 */
export function normalizeBBCode(text: string): string {
  if (!text) return text
  let out = text

  // [br] -> a real newline, so it flows through the same \n -> <br> step
  // below. Left alone, the catch-all "strip unrecognised BBCode" pass would
  // delete it with nothing in its place, gluing both sides together.
  out = out.replace(/\[br\]/gi, '\n')

  // [img]/[video] -> a bare URL, so extractMedia's bare-URL scan picks it up
  // like a pasted link. Newline-padded rather than a bare "$1": back-to-back
  // tags with no separator would otherwise unwrap into one glued string that
  // is neither URL.
  out = out.replace(/\[img\]([\s\S]*?)\[\/img\]/gi, '\n$1\n')
  out = out.replace(/\[video\]([\s\S]*?)\[\/video\]/gi, '\n$1\n')

  // [url=X]X[/url] - a link wrapping its own URL, usually what's left after
  // the [img] unwrap above. Collapsed to bare X so extractMedia sees one clean
  // URL; left alone, the trailing "[/url]" runs into the URL match and breaks
  // the extension check. Only fires when the label matches the href, so a
  // genuine custom-label link still reaches the [url=] handling below.
  out = out.replace(/\[url=(https?:\/\/[^\]\s]+)\]\s*\1\s*\[\/url\]/gi, '$1')

  // [spoiler] -> the ||text|| convention formatMessage already handles.
  out = out.replace(/\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi, '||$1||')

  // [quote] -> "> "-prefixed lines. Wrapped in its own newlines because quote
  // extraction is line-based, so an inline "[quote]x[/quote] tail" would
  // otherwise glue the tail onto the quote's last line.
  out = out.replace(/\[quote\]([\s\S]*?)\[\/quote\]/gi, (_m, inner: string) => {
    return '\n' + inner.trim().split('\n').map((l) => '> ' + l).join('\n') + '\n'
  })

  // [php]/[plain]/[code=lang] are block code on that site; plain [code] stays
  // inline. Fenced ``` is what extractCodeBlocks expects.
  out = out.replace(/\[(?:php|plain|code=\w+)\]([\s\S]*?)\[\/(?:php|plain|code)\]/gi, '```$1```')
  out = out.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, '`$1`')

  // [size=..] has no equivalent in a compact log - unwrap rather than risk
  // breaking layout with arbitrary text scaling.
  out = out.replace(/\[size=[^\]]*\]([\s\S]*?)\[\/size\]/gi, '$1')

  // No real list layout here; a leading bullet reads close enough.
  out = out.replace(/\[\*\]\s*/gi, '• ')
  out = out.replace(/\[\/?list\]/gi, '')

  return out
}

export interface SmilieIndex {
  byAlias: Record<string, SmilieEntry>
  regex: RegExp | null
}

export interface SmilieEntry extends SockchatSmilie {
  url: string
}

/**
 * One compiled alternation of every known shortcode, longest first so a short
 * alias can never pre-empt a longer one containing it. Built once per smilie
 * fetch, not per message row.
 */
export function buildSmilieIndex(smilies: SmilieEntry[]): SmilieIndex {
  const byAlias: Record<string, SmilieEntry> = {}
  for (const s of smilies) {
    for (const alias of s.aliases || []) byAlias[alias] = s
  }
  const aliases = Object.keys(byAlias)
  if (aliases.length === 0) return { byAlias, regex: null }
  const sorted = aliases.slice().sort((a, b) => b.length - a.length)
  const escaped = sorted.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return { byAlias, regex: new RegExp(escaped.join('|'), 'g') }
}

export interface FormatOptions {
  revealedSpoilers?: Record<number, boolean>
  isSockchat?: boolean
  smilies?: SmilieIndex | null
}

/**
 * `revealedSpoilers` is a per-message {index: true} map - spoilers are
 * numbered in the order they appear here, so the same message always maps the
 * same index to the same run.
 */
export function formatMessage(text: string, opts: FormatOptions = {}): string {
  if (!text) return text
  const revealed = opts.revealedSpoilers || {}

  // Stash already-formed markup so later passes don't re-touch its contents,
  // then restore at the end. Wrapped in a word marker rather than bare digits:
  // a bare-digit placeholder collides with any real number in the message the
  // moment two passes stow for the same body, which the spoiler and
  // inline-code passes make routine.
  const stash: string[] = []
  const stow = (html: string): string => {
    stash.push(html)
    return `STOWMARKER${stash.length - 1}STOWMARKER`
  }

  let out = text

  // Existing HTML anchors (case-insensitive - some channels send <A HREF=...>).
  out = out.replace(
    /<a\s+href=["']([^"']+)["']\s*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, label: string) => stow(`<a href="${href}">${label}</a>`)
  )

  // Inline `code` spans, stowed before anything else touches them so backticked
  // content is never reinterpreted as markdown or links, and escaped since code
  // commonly contains < > & that would corrupt the parse.
  out = out.replace(/`([^`\n]+)`/g, (_m, code: string) =>
    stow(`<span class="inline-code">&nbsp;${escapeHtml(code)}&nbsp;</span>`)
  )

  // Spoilers: ||text||, hidden behind a solid bar until clicked, same as
  // Discord. Emitted as a link with a "spoiler:N" href purely so the click can
  // be caught and this message's own revealed state flipped; it never navigates.
  let spoilerIndex = 0
  out = out.replace(/\|\|([\s\S]+?)\|\|/g, (_m, inner: string) => {
    const idx = spoilerIndex++
    if (revealed[idx]) return stow(`<span class="spoiler revealed">${escapeHtml(inner)}</span>`)
    return stow(`<a href="spoiler:${idx}" class="spoiler">${escapeHtml(inner)}</a>`)
  })

  // Sneedchat smiley shortcodes - only for a Sneedchat buffer, and only after
  // code/anchor/spoiler content is stowed, so this never reaches inside a code
  // span or an unrevealed spoiler. Must also run before the markdown pass
  // below, since several real shortcodes ("*sigh*", "*YAWN*") are shaped like
  // markdown emphasis and would otherwise be mangled into <i>sigh</i> before
  // ever being recognised as a smiley.
  if (opts.isSockchat && opts.smilies?.regex) {
    out = out.replace(new RegExp(opts.smilies.regex.source, 'g'), (m: string) => {
      const s = opts.smilies!.byAlias[m]
      // An empty url only happens if resource-path resolution failed - leave
      // the plain shortcode visible rather than a broken image.
      if (!s || !s.url) return m
      // No explicit width/height: most of these are small by design (24-64px),
      // and forcing a fixed square distorts the wider banner-shaped ones.
      return stow(`<img src="${s.url}" class="smilie" alt="${escapeHtml(m)}">`)
    })
  }

  // Markdown links: [label](url)
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, label: string, href: string) => stow(`<a href="${href}">${label}</a>`)
  )

  // BBCode links.
  out = out.replace(
    /\[url=(https?:\/\/[^\]\s]+)\]([\s\S]*?)\[\/url\]/gi,
    (_m, href: string, label: string) => stow(`<a href="${href}">${label}</a>`)
  )
  out = out.replace(/\[url\](https?:\/\/[^\]\s]+)\[\/url\]/gi, (_m, href: string) =>
    stow(`<a href="${href}">${href}</a>`)
  )

  // BBCode formatting. [strong]/[em] are aliases seen from the same site, and
  // \s* before the closing tag name tolerates the odd "[/ b]" spacing variant.
  out = out.replace(/\[(?:b|strong)\]([\s\S]*?)\[\/\s*(?:b|strong)\]/gi, '<b>$1</b>')
  out = out.replace(/\[(?:i|em)\]([\s\S]*?)\[\/\s*(?:i|em)\]/gi, '<i>$1</i>')
  out = out.replace(/\[u\]([\s\S]*?)\[\/\s*u\]/gi, '<u>$1</u>')
  out = out.replace(/\[(?:s|strike)\]([\s\S]*?)\[\/\s*(?:s|strike)\]/gi, '<s>$1</s>')

  // [color=..] - most notably the greentext convention. The captured value is
  // restricted to a safe alphanumeric/# pattern before it reaches a style
  // attribute, since this is otherwise attacker-controlled text. (richtext.tsx
  // re-validates it independently rather than trusting this.)
  out = out.replace(
    /\[color=(#?[0-9a-zA-Z]+)\]([\s\S]*?)\[\/color\]/gi,
    (_m, c: string, inner: string) => `<span style="color:${c}">${inner}</span>`
  )

  // Markdown emphasis - bold and strikethrough first, so their delimiters
  // aren't left stray for the italic pass to mangle.
  out = out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  out = out.replace(/__([^_]+)__/g, '<b>$1</b>')
  out = out.replace(/~~([^~]+)~~/g, '<s>$1</s>')
  out = out.replace(/\*([^*]+)\*/g, '<i>$1</i>')
  out = out.replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1<i>$2</i>')

  // Any bare URL not already wrapped by one of the formats above.
  out = out.replace(/((?:https?|file):\/\/[^\s<]+)/g, '<a href="$1">$1</a>')

  // Anything else BBCode-shaped that wasn't recognised (e.g. [USER=..]
  // mentions, [sub]/[sup], a typo'd tag) - stripped rather than shown as
  // literal markup, matching how the forum's own plain-text views degrade.
  out = out.replace(/\[\/?[A-Za-z][A-Za-z0-9\-_]*(?:=[^\]]*)?\]/g, '')

  out = out.replace(/STOWMARKER(\d+)STOWMARKER/g, (_m, i: string) => stash[Number(i)])

  // A literal "\n" is just collapsible whitespace in HTML; a structured
  // multi-line message (a relay bot's author/link/stats/footer post) would
  // otherwise render as one run-together line.
  out = out.replace(/\n/g, '<br>')
  return out
}

export function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{11})/)
  return m ? m[1] : null
}

export function hostnameOf(url: string): string {
  const m = url.match(/^https?:\/\/([^/]+)/i)
  return m ? m[1].replace(/:\d+$/, '').toLowerCase() : ''
}

/**
 * ShareX-style personal upload hosts that serve images at an opaque short-code
 * path with no extension anywhere in the URL - extension-based detection can
 * never match these, since the information isn't in the URL text.
 *
 * Checked before falling through to a Content-Type probe: a known host needs
 * no network round trip at all, so listing one here is strictly better than
 * sniffing for it.
 */
export const OPAQUE_IMAGE_HOSTS = ['i.ddos.lgbt']

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp)(\?\S*)?$/i
const VIDEO_EXT_RE = /\.(mp4|webm|mov|mkv|ogv)(\?\S*)?$/i

/**
 * Heuristic, extension- and pattern-based detection: IRC has no attachment
 * metadata the way Discord's API does.
 *
 * `sniffed` supplies already-resolved Content-Type answers; `onNeedSniff` is
 * called for links nothing else could classify, and the caller re-runs this
 * once the answer lands.
 */
export function extractMedia(
  text: string,
  opts: {
    contentSniffing?: boolean
    sniffed?: Record<string, string>
    onNeedSniff?: (url: string) => void
  } = {}
): MediaItem[] {
  if (!text) return []

  // `[` and `]` excluded alongside whitespace and `<`: a URL sitting right
  // against an unrecognised BBCode tag ("...webp[/url]") would otherwise be
  // swallowed whole, corrupting the extension check.
  //
  // `file://` alongside `https?://` - chatd rewrites a Kiwi Farms attachment
  // link into a local cached path once it's fetched through Tor. That only
  // ever originates from chatd's own substitution, never from a remote
  // message's raw text.
  const urls = text.match(/(?:https?|file):\/\/[^\s<[\]]+/g) || []
  const result: MediaItem[] = []
  // A message legitimately repeating the same link (quoted text plus the
  // original) shouldn't render the same embed twice.
  const seen = new Set<string>()

  for (const raw of urls) {
    const url = raw.replace(/[),.;!?]+$/, '')
    if (seen.has(url)) continue

    const yt = youtubeId(url)
    if (yt) {
      seen.add(url)
      result.push({ url, kind: 'youtube', youtubeId: yt })
    } else if (IMAGE_EXT_RE.test(url)) {
      seen.add(url)
      result.push({ url, kind: 'image' })
    } else if (VIDEO_EXT_RE.test(url)) {
      seen.add(url)
      result.push({ url, kind: 'video' })
    } else if (OPAQUE_IMAGE_HOSTS.includes(hostnameOf(url))) {
      seen.add(url)
      result.push({ url, kind: 'image' })
    } else if (opts.contentSniffing && /^https?:\/\//i.test(url)) {
      // Nothing else could classify this. Not for file:// URLs: those are
      // always chatd's own already-classified attachment paths.
      const sniffed = opts.sniffed?.[url]
      if (sniffed === 'image' || sniffed === 'video') {
        seen.add(url)
        result.push({ url, kind: sniffed })
      } else if (sniffed === undefined) {
        opts.onNeedSniff?.(url)
      }
    }
  }
  return result
}

/**
 * Once a URL has rendered as an inline embed, showing it again as link text in
 * the body reads as noise - Discord hides it the same way. Only strips URLs
 * that actually became an embed, so other links keep showing normally.
 */
export function stripEmbeddedUrls(text: string, mediaItems: MediaItem[]): string {
  if (!text || mediaItems.length === 0) return text
  let out = text
  for (const item of mediaItems) out = out.split(item.url).join('')
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Fenced code blocks are pulled out and rendered in a monospace,
 * non-wrapping, horizontally scrollable box rather than flowing through the
 * word-wrapped body - long lines (a URL, a wide table) stay intact and scroll
 * instead of wrapping into an unreadable ragged mess.
 */
export function extractCodeBlocks(text: string): string[] {
  if (!text) return []
  const blocks: string[] = []
  const re = /```(?:[ \t]*\w+\n)?([\s\S]*?)```/g
  let m: RegExpExecArray | null
  // Trim one newline at each end. The optional language group only matches
  // when a language is actually named, so a plain ```\ncode\n``` fence leaves
  // its opening newline inside the capture - which renders as a blank first
  // line in every such block.
  while ((m = re.exec(text)) !== null) blocks.push(m[1].replace(/^\n/, '').replace(/\n$/, ''))
  return blocks
}

export function stripCodeBlocks(text: string): string {
  if (!text) return text
  return text
    .replace(/```(?:[ \t]*\w+\n)?[\s\S]*?```/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Discord-style blockquotes: consecutive "> " lines group into one quote,
 * pulled out to render with a left accent bar instead of showing the literal
 * "> " prefix inline.
 */
export function extractQuoteBlocks(text: string): string[] {
  if (!text) return []
  const blocks: string[] = []
  let current: string[] | null = null
  for (const line of text.split('\n')) {
    const m = line.match(/^>\s?(.*)$/)
    if (m) {
      if (current === null) current = []
      current.push(m[1])
    } else if (current !== null) {
      blocks.push(current.join('\n'))
      current = null
    }
  }
  if (current !== null) blocks.push(current.join('\n'))
  return blocks
}

export function stripQuoteBlocks(text: string): string {
  if (!text) return text
  return text
    .split('\n')
    .filter((line) => !/^>\s?/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Discord's own decimal RGB embed colour as a CSS hex string. */
export function embedColor(color?: number): string | undefined {
  if (color === undefined || color === null) return undefined
  return '#' + (color & 0xffffff).toString(16).padStart(6, '0')
}
