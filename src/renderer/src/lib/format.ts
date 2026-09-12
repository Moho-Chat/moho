import type { SneedchatSmilie } from '../../../shared/wire'
// Shared with the main process, which is what actually opens a clicked link.
export { clearnetLinks } from '../../../shared/clearnet'

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
  /**
   * A bigger copy of the same picture, where the message said where one is.
   *
   * A forum post that wraps a thumbnail in a link to the full-size image is
   * saying two things - show this, open that - and only the first of them used
   * to arrive here. Set when the wrapped link is itself an image.
   */
  full?: string
  /**
   * And where the wrapped link is a page about the picture rather than the
   * picture - which is what every image host's "thumbnail for forums" button
   * actually produces - the page, to be asked what it is showing at the moment
   * somebody opens it.
   */
  page?: string
}

/**
 * The picture for a Discord custom emoji.
 *
 * Always WebP, and always asking for the animated form, rather than choosing
 * .gif or .png from the emoji's `animated` flag. That flag is not reliable:
 * a fifth of one guild's emoji here are flagged animated while the CDN holds
 * only a still image for them, and asking that CDN for a .gif it does not
 * have is a 415, which is a broken-image box in the picker and in every
 * message using it. WebP is served for both kinds, so nothing has to be
 * guessed - Discord's own client fetches emoji this way for the same reason.
 *
 * The flag is still right for the `<a:name:id>` token a message carries;
 * it is only useless for picking a file extension.
 */
export function discordEmojiUrl(id: string, size = 44): string {
  return `https://cdn.discordapp.com/emojis/${id}.webp?size=${size}&animated=true`
}

/**
 * The picture for a Kick emote.
 *
 * One size only. The `/default` and `/small` variants other emote hosts serve
 * are a 403 here, so asking for anything but fullsize is a broken image in
 * every message rather than a smaller one.
 */
export function kickEmoteUrl(id: string): string {
  return `https://files.kick.com/emotes/${id}/fullsize`
}

/** What something picked out of the emoji list looks like, when it isn't text. */
export interface EmojiPreview {
  /** Possibly a local path - run it through resolveMediaUrl before use. */
  src: string
  label: string
}

/**
 * The picture behind a piece of text that stands in for an emoji, or null when
 * the text is the emoji.
 *
 * A Unicode emoji is its own picture and needs nothing. The others are
 * stand-ins - Discord's `<:name:id>`, Kick's `[emote:id:name]`, a Sneedchat
 * shortcode - and anywhere they are shown to a person rather than sent to a
 * server, they should be shown as what they stand for. The composer and the picker's recent list both showed
 * the stand-in, so choosing an emoji put `<:lettyCrazy:1413156421880647762>` in
 * the message box and left it there in the recents afterwards.
 *
 * Discord's and Kick's forms carry their own ids, so they resolve anywhere. A
 * shortcode only resolves where the smilie table is loaded, which is a
 * Sneedchat buffer -
 * elsewhere the shortcode is genuinely all that is known, and showing it is
 * honest rather than broken.
 */
export function emojiPreview(text: string, smilies: SmilieEntry[] = []): EmojiPreview | null {
  const custom = text.match(/^<a?:([A-Za-z0-9_~]{2,32}):(\d+)>$/)
  if (custom) return { src: discordEmojiUrl(custom[2]), label: `:${custom[1]}:` }
  const kick = text.match(/^\[emote:(\d+):([^\]]{0,64})\]$/)
  if (kick) return { src: kickEmoteUrl(kick[1]), label: `:${kick[2]}:` }
  const smilie = smilies.find((s) => s.aliases?.includes(text))
  if (smilie?.url) return { src: smilie.url, label: smilie.label }
  return null
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

/**
 * The pairs a forum post makes when it wraps a picture in a link.
 *
 * `[url=X][img]Y[/img][/url]` is what every image host's "for forums" button
 * hands you, and it means show Y, open X. Read from the raw body because
 * `normalizeBBCode` unwraps both tags into bare URLs, after which the pair is
 * two links in a row and nothing says they were ever related.
 *
 * Keyed by the thumbnail, which is what `extractMedia` will go on to find in
 * the normalised text.
 */
export function thumbnailLinks(text: string): Record<string, string> {
  const pairs: Record<string, string> = {}
  if (!text) return pairs
  const re = /\[url=(https?:\/\/[^\]\s]+)\]\s*\[img\]\s*(https?:\/\/[^\[\s]+?)\s*\[\/img\]\s*\[\/url\]/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const [, href, thumb] = m
    // A link to the picture it is already showing says nothing; the pair only
    // means something when the two differ.
    if (href !== thumb) pairs[thumb] = href
  }
  return pairs
}

export interface SmilieIndex {
  byAlias: Record<string, SmilieEntry>
  regex: RegExp | null
}

export interface SmilieEntry extends SneedchatSmilie {
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

/** Buffers this client knows about, keyed by the service's own channel id. */
export type ChannelIndex = Record<string, { bufferId: string; name: string }>

export interface FormatOptions {
  revealedSpoilers?: Record<number, boolean>
  isSneedchat?: boolean
  smilies?: SmilieIndex | null
  /** Resolves Discord's `<#id>` channel links; without it they stay literal. */
  channels?: ChannelIndex | null
  /**
   * What to do with IRC's own formatting codes: render them, or strip them.
   *
   * Absent means strip, which is what every non-IRC protocol wants - a stray
   * \x02 in a Discord message is a control character somebody pasted, not
   * bold.
   */
  ircFormatting?: 'render' | 'strip'
}

/**
 * `revealedSpoilers` is a per-message {index: true} map - spoilers are
 * numbered in the order they appear here, so the same message always maps the
 * same index to the same run.
 */
/** mIRC's sixteen colours, in their numbered order. */
const MIRC_COLOURS = [
  '#ffffff', '#000000', '#00007f', '#009300', '#ff0000', '#7f0000', '#9c009c', '#fc7f00',
  '#ffff00', '#00fc00', '#009393', '#00ffff', '#0000fc', '#ff00ff', '#7f7f7f', '#d2d2d2'
]

/** Every code IRC uses to mark up a line. */
const IRC_CODES = /[\u0002\u001d\u001f\u0016\u000f\u0003\u0004]/

/**
 * Turns IRC's formatting codes into markup, or removes them.
 *
 * These are the oldest formatting in chat and moho showed them as control
 * characters: `\x02` bold, `\x1d` italic, `\x1f` underline, `\x16` reverse,
 * `\x0f` reset, and `\x03fg,bg` colour. On a channel where anyone uses colour
 * - which is every channel with a bot in it - the text arrived with invisible
 * junk in the middle of it.
 *
 * Rendered with inline styles rather than classes because the colours are
 * numbered by the protocol, not chosen by this client; the palette is mIRC's
 * own, which is what every other client draws.
 */
export function ircFormat(text: string, mode: 'render' | 'strip'): string {
  if (!IRC_CODES.test(text)) return text

  if (mode === 'strip') {
    return text
      // Colour: the code plus up to "99,99" of digits.
      .replace(/\u0003\d{0,2}(,\d{1,2})?/g, '')
      .replace(/\u0004[0-9a-fA-F]{6}(,[0-9a-fA-F]{6})?/g, '')
      .replace(/[\u0002\u001d\u001f\u0016\u000f]/g, '')
  }

  let out = ''
  let open = 0
  let bold = false
  let italic = false
  let underline = false
  let colour: string | null = null
  let background: string | null = null

  const restyle = (): void => {
    // One span per change rather than nesting each attribute: the codes
    // toggle independently and in any order, so a stack would have to be
    // unwound out of order - which is not a thing HTML can do.
    while (open > 0) {
      out += '</span>'
      open--
    }
    const styles: string[] = []
    if (bold) styles.push('font-weight:600')
    if (italic) styles.push('font-style:italic')
    if (underline) styles.push('text-decoration:underline')
    if (colour) styles.push(`color:${colour}`)
    if (background) styles.push(`background:${background}`)
    if (styles.length) {
      out += `<span style="${styles.join(';')}">`
      open++
    }
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    switch (ch) {
      case '\u0002':
        bold = !bold
        restyle()
        break
      case '\u001d':
        italic = !italic
        restyle()
        break
      case '\u001f':
        underline = !underline
        restyle()
        break
      case '\u0016':
        // Reverse video: swap the two, which is what it means and is far
        // more legible than trying to invert whatever theme is in use.
        [colour, background] = [background ?? MIRC_COLOURS[0], colour ?? MIRC_COLOURS[1]]
        restyle()
        break
      case '\u000f':
        bold = italic = underline = false
        colour = background = null
        restyle()
        break
      case '\u0003': {
        const match = /^(\d{1,2})?(?:,(\d{1,2}))?/.exec(text.slice(i + 1))
        const [whole, fg, bg] = match ?? ['', undefined, undefined]
        // A bare \x03 with no digits turns colour off, which is how a line
        // ends a coloured run without resetting bold along with it.
        colour = fg === undefined ? null : MIRC_COLOURS[Number(fg) % 16]
        if (bg !== undefined) background = MIRC_COLOURS[Number(bg) % 16]
        if (fg === undefined) background = null
        i += whole.length
        restyle()
        break
      }
      // Hex colour, the newer extension: \x04RRGGBB.
      case '\u0004': {
        const match = /^([0-9a-fA-F]{6})(?:,([0-9a-fA-F]{6}))?/.exec(text.slice(i + 1))
        if (!match) {
          colour = background = null
        } else {
          colour = `#${match[1]}`
          if (match[2]) background = `#${match[2]}`
          i += match[0].length
        }
        restyle()
        break
      }
      default:
        out += ch
    }
  }
  while (open > 0) {
    out += '</span>'
    open--
  }
  return out
}

export function formatMessage(text: string, opts: FormatOptions = {}): string {
  if (!text) return text
  const revealed = opts.revealedSpoilers || {}
  // First, because the codes are invisible characters sitting anywhere in the
  // line: a colour code inside a URL or between a pair of asterisks would
  // otherwise break the pass that reads it. Stripped rather than rendered for
  // every protocol that does not use them, where a control character is
  // something somebody pasted rather than formatting.
  text = ircFormat(text, opts.ircFormatting === 'render' ? 'render' : 'strip')

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

  // Discord custom emoji, which arrive in the body as `<:name:id>` (or
  // `<a:name:id>` when animated) and were previously shown exactly like that.
  // No lookup is needed - the id is in the token, and the picture is public -
  // so this works for any guild's emoji, including ones from a server this
  // account is not in.
  out = out.replace(/<(a?):([A-Za-z0-9_~]{2,32}):(\d+)>/g, (_m, _anim: string, name: string, id: string) =>
    stow(`<img src="${discordEmojiUrl(id, 48)}" class="custom-emoji" alt=":${escapeHtml(name)}:">`)
  )

  // Kick emotes, which arrive as `[emote:1082364:xqcAM]`. Like Discord's
  // above, no lookup is needed: the id is in the token and the picture is
  // public, so this draws every emote in a channel - including the
  // subscriber-only ones, which is the point. Gating what somebody can *see*
  // on what they have paid for would leave a newcomer reading a chat that is
  // half raw tokens, and the tier gates sending, not looking.
  out = out.replace(/\[emote:(\d+):([^\]]{0,64})\]/g, (_m, id: string, name: string) =>
    stow(`<img src="${kickEmoteUrl(id)}" class="custom-emoji" alt=":${escapeHtml(name)}:">`)
  )

  // Discord channel links. What arrives is `<#1393001234568164748>` and
  // nothing else - no name anywhere in the payload - so this is the only
  // chance to make it read as the "#general" the sender saw when they typed
  // it. Stowed like a link because it becomes one: richtext turns the
  // `channel:` href into a click that switches buffers rather than something
  // the browser navigates. An id nothing here knows still beats showing the
  // raw token, which reads as a bug.
  out = out.replace(/<#(\d+)>/g, (_m, id: string) => {
    const known = opts.channels?.[id]
    if (!known) return stow('<span class="channel-mention unknown">#unknown-channel</span>')
    // The "#" is drawn here, so a name that already carries one (IRC's do,
    // and so does the Discord half of "Guild/#general") must not double it.
    const label = known.name.replace(/^#+/, '')
    return stow(
      `<a href="channel:${encodeURIComponent(known.bufferId)}" class="channel-mention">#${escapeHtml(label)}</a>`
    )
  })

  // Sneedchat smiley shortcodes - only for a Sneedchat buffer, and only after
  // code/anchor/spoiler content is stowed, so this never reaches inside a code
  // span or an unrevealed spoiler. Must also run before the markdown pass
  // below, since several real shortcodes ("*sigh*", "*YAWN*") are shaped like
  // markdown emphasis and would otherwise be mangled into <i>sigh</i> before
  // ever being recognised as a smiley.
  if (opts.isSneedchat && opts.smilies?.regex) {
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
  // ircs? alongside the web schemes: a link to a channel is a link, and one
  // written in a message means exactly what the same link means in a browser.
  out = out.replace(/((?:https?|file|ircs?):\/\/[^\s<]+)/g, '<a href="$1">$1</a>')

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

/**
 * The video id in any of the forms a YouTube link actually arrives in.
 *
 * `/embed/` matters as much as `watch?v=`: Discord resolves a posted YouTube
 * link into a rich embed whose `video.url` is the *embed page*, and nobilis
 * carries that through as the message body. Missing it meant those messages
 * showed no thumbnail and, worse, had their embed page probed over the network
 * as if it might be a media file - a request that can only ever fail.
 */
export function youtubeId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/
  )
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

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|avif)(\?\S*)?$/i
const VIDEO_EXT_RE = /\.(mp4|webm|mov|mkv|ogv)(\?\S*)?$/i

/**
 * What a thumbnail was linked to, told apart by what it is.
 *
 * A link straight to a bigger file can be opened as it stands. A link to a
 * page - which is what an image host's share button gives, the picture being
 * one thing on it - has to be asked what it is showing, and that is a request
 * worth making only when somebody opens the picture, so it is carried as a
 * page and left alone until then.
 */
function biggerCopy(
  thumb: string,
  thumbnails?: Record<string, string>
): { full?: string; page?: string } {
  const target = thumbnails?.[thumb]
  if (!target) return {}
  const direct = IMAGE_EXT_RE.test(target) || OPAQUE_IMAGE_HOSTS.includes(hostnameOf(target))
  return direct ? { full: target } : { page: target }
}

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
    /** Thumbnail URL -> what the post linked it to; see `thumbnailLinks`. */
    thumbnails?: Record<string, string>
  } = {}
): MediaItem[] {
  if (!text) return []

  // `[` and `]` excluded alongside whitespace and `<`: a URL sitting right
  // against an unrecognised BBCode tag ("...webp[/url]") would otherwise be
  // swallowed whole, corrupting the extension check.
  //
  // `file://` alongside `https?://` - nobilis rewrites a Kiwi Farms attachment
  // link into a local cached path once it's fetched through Tor. That only
  // ever originates from nobilis's own substitution, never from a remote
  // message's raw text.
  const urls = text.match(/(?:https?|file):\/\/[^\s<[\]]+/g) || []
  const result: MediaItem[] = []
  // A message legitimately repeating the same link (quoted text plus the
  // original) shouldn't render the same embed twice.
  //
  // Keyed by what the link *is* rather than by its text, which for YouTube is
  // the video: the same video reaches here as a watch URL and an /embed/ one
  // - two strings, one video - and keying on the string showed it twice.
  const seen = new Set<string>()

  // What the thumbnails were linked to. Those URLs are in the text as well -
  // inside the `[url=]` that wrapped the picture - and each is the same
  // picture as the thumbnail naming it, so drawing both shows the message
  // twice: once small, once large.
  const targets = new Set(Object.values(opts.thumbnails ?? {}))

  for (const raw of urls) {
    const url = raw.replace(/[),.;!?]+$/, '')
    const yt = youtubeId(url)
    const identity = yt ? `yt:${yt}` : url
    if (seen.has(identity) || targets.has(url)) continue

    if (yt) {
      seen.add(identity)
      result.push({ url, kind: 'youtube', youtubeId: yt })
    } else if (IMAGE_EXT_RE.test(url)) {
      seen.add(identity)
      result.push({ url, kind: 'image', ...biggerCopy(url, opts.thumbnails) })
    } else if (VIDEO_EXT_RE.test(url)) {
      seen.add(identity)
      result.push({ url, kind: 'video' })
    } else if (OPAQUE_IMAGE_HOSTS.includes(hostnameOf(url))) {
      seen.add(identity)
      result.push({ url, kind: 'image', ...biggerCopy(url, opts.thumbnails) })
    } else if (opts.contentSniffing && /^https?:\/\//i.test(url)) {
      // Nothing else could classify this. Not for file:// URLs: those are
      // always nobilis's own already-classified attachment paths.
      const sniffed = opts.sniffed?.[url]
      if (sniffed === 'image' || sniffed === 'video') {
        seen.add(identity)
        result.push({
          url,
          kind: sniffed,
          ...(sniffed === 'image' ? biggerCopy(url, opts.thumbnails) : {})
        })
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

  // A link left holding nothing, which is what the wrapper round a thumbnail
  // becomes once the picture it was wrapping has been lifted out and drawn as
  // an embed. Rendered, it is an anchor with no text: nothing to see, a stray
  // clickable pixel, and an empty element in the log. Removed here rather than
  // when the markup is rendered because this is where it was emptied, and the
  // whitespace tidy at the end of this function is what puts the line back
  // together afterwards.
  out = out.replace(/\[url=[^\]]*\]\s*\[\/url\]/gi, '')

  // A second link to a video already embedded goes too. It renders no second
  // embed - the same video is shown once - so leaving its URL as text is the
  // one case where a stripped link would come back as a bare line above the
  // thing it points at.
  const shown = new Set(mediaItems.map((m) => m.youtubeId).filter(Boolean))
  if (shown.size) {
    for (const raw of out.match(/https?:\/\/[^\s<[\]]+/g) || []) {
      const id = youtubeId(raw.replace(/[),.;!?]+$/, ''))
      if (id && shown.has(id)) out = out.split(raw).join('')
    }
  }
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
