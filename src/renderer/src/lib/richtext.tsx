import { useState, type ReactNode } from 'react'
import { MEDIA_SCHEME, resolveMediaUrl } from './util'
import { isDeepLink } from '../../../shared/deeplink'

/**
 * Turns the restricted HTML that format.ts produces into React nodes, through
 * a strict whitelist.
 *
 * Message bodies are fully attacker-controlled and the formatter deliberately
 * lets basic inline markup through (matching the original frontend, where a
 * message containing <b>hi</b> really did render bold). Injecting that string
 * with dangerouslySetInnerHTML would also hand over <script>, <iframe>,
 * onerror= and javascript: hrefs. Parsing it into an inert document and
 * rebuilding only the tags and attributes named here keeps the formatting
 * behaviour while making those unreachable: anything not whitelisted degrades
 * to its text content.
 */

const ALLOWED_TAGS = new Set([
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'S',
  'STRIKE',
  'SPAN',
  'A',
  'IMG',
  'BR',
  // Structure, for the formatting Matrix senders actually use. None of
  // these can carry behaviour - they are containers, and every attribute is
  // filtered separately below - so allowing them widens what renders
  // without widening what can run. Anything still outside the list keeps
  // degrading to its text.
  'P',
  'CODE',
  'PRE',
  'BLOCKQUOTE',
  'UL',
  'OL',
  'LI',
  'DEL',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6'
])

/**
 * Tags whose text content is markup rather than prose. Everything else that
 * isn't whitelisted degrades to its text (so <div>hi</div> still shows "hi"),
 * but doing that for these would paint raw script source into the message.
 */
const DROP_CONTENT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED'])

/** Only the classes format.ts itself emits; anything else is dropped. */
const ALLOWED_CLASSES = new Set([
  'inline-code',
  'spoiler',
  'revealed',
  'smilie',
  'channel-mention',
  'unknown',
  'custom-emoji'
])

/** Hex or a plain CSS colour keyword - nothing that could carry a url() or expression. */
const SAFE_COLOR = /^#[0-9a-f]{3,8}$|^[a-z]{3,20}$/i
const SAFE_WEIGHT = /^(bold|[1-9]00)$/i
const SAFE_FONT_STYLE = /^italic$/i
const SAFE_DECORATION = /^underline$/i

/**
 * The handful of style properties a message is allowed to set on a span.
 *
 * Named individually rather than passed through: this is markup derived from
 * what somebody said, and a style attribute is a large surface - `position`,
 * `content` and a URL in a `background` are all ways to make a message do
 * something to the page around it.
 */
function safeSpanStyle(attr: string | null): React.CSSProperties | undefined {
  if (!attr) return undefined
  const read = (prop: string): string | undefined =>
    attr.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i'))?.[1]?.trim()

  const style: React.CSSProperties = {}
  const color = read('color')
  if (color && SAFE_COLOR.test(color)) style.color = color
  const background = read('background')
  if (background && SAFE_COLOR.test(background)) style.background = background
  const weight = read('font-weight')
  if (weight && SAFE_WEIGHT.test(weight)) style.fontWeight = weight
  const fontStyle = read('font-style')
  if (fontStyle && SAFE_FONT_STYLE.test(fontStyle)) style.fontStyle = 'italic'
  const decoration = read('text-decoration')
  if (decoration && SAFE_DECORATION.test(decoration)) style.textDecoration = 'underline'

  return Object.keys(style).length ? style : undefined
}

export interface RichTextProps {
  html: string
  /** Called with the spoiler's index when a hidden run is clicked. */
  onRevealSpoiler?: (index: number) => void
  /** Called with a buffer id when a channel link is clicked. */
  onOpenChannel?: (bufferId: string) => void
  /** An irc:// link, which moho acts on itself rather than the desktop. */
  onOpenLink?: (url: string) => void
}

/** The callbacks walk() carries down, bundled so adding one is a single change. */
interface Handlers {
  onRevealSpoiler?: RichTextProps['onRevealSpoiler']
  onOpenChannel?: RichTextProps['onOpenChannel']
  onOpenLink?: RichTextProps['onOpenLink']
}

export function RichText({ html, onRevealSpoiler, onOpenChannel, onOpenLink }: RichTextProps): JSX.Element {
  // DOMParser builds an inert document: no scripts run, no images load, no
  // network requests happen during parsing.
  //
  // Measured rather than assumed, because it was once doubted (#142): a body
  // carrying `<link rel=stylesheet>`, `<style>@font-face`, `<img src=https:>`,
  // a CSS `background: url()` and a `<script src>` was parsed here with the
  // network watched, and not one of the five was fetched. The parse is safe;
  // what a message can reach for, it reaches for when something *renders*.
  //
  // Which is a live surface rather than a theoretical one: `safeImageSrc`
  // below passes any https image through, so a formatted body can name a URL
  // its author controls and learn that the message was read - see #145.
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  return <>{walk(doc.body, { onRevealSpoiler, onOpenChannel, onOpenLink }, 0)}</>
}

function walk(node: Node, handlers: Handlers, depth: number): ReactNode[] {
  const { onRevealSpoiler, onOpenChannel, onOpenLink } = handlers
  const out: ReactNode[] = []
  // Depth guard: deeply nested markup in a hostile body shouldn't be able to
  // blow the stack. Beyond this, render the remaining subtree as flat text.
  if (depth > 24) return [node.textContent]

  node.childNodes.forEach((child, i) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out.push(child.nodeValue)
      return
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return

    const el = child as Element
    if (DROP_CONTENT.has(el.tagName)) return
    if (!ALLOWED_TAGS.has(el.tagName)) {
      // Not whitelisted: keep the text, discard the element itself.
      out.push(el.textContent)
      return
    }

    const key = `${depth}-${i}`
    const className = classNameOf(el)
    const kids = (): ReactNode[] => walk(el, handlers, depth + 1)

    switch (el.tagName) {
      case 'BR':
        out.push(<br key={key} />)
        break

      case 'IMG': {
        const src = el.getAttribute('src') || ''
        const resolved = safeImageSrc(src)
        const alt = el.getAttribute('alt') || ''
        if (!resolved) break
        // A custom emoji that has since been deleted from its guild leaves a
        // token in every message that used it, and a broken-image box is a
        // worse answer than the ":name:" the sender typed.
        if (className === 'custom-emoji') {
          out.push(<CustomEmoji key={key} src={resolved} alt={alt} />)
          break
        }
        out.push(<img key={key} src={resolved} className={className} alt={alt} />)
        break
      }

      case 'A': {
        const href = el.getAttribute('href') || ''
        const spoiler = href.match(/^spoiler:(\d+)$/)
        if (spoiler) {
          const idx = Number(spoiler[1])
          out.push(
            <span
              key={key}
              className={className}
              role="button"
              tabIndex={0}
              title="Click to reveal"
              onClick={() => onRevealSpoiler?.(idx)}
              onKeyDown={(e) => e.key === 'Enter' && onRevealSpoiler?.(idx)}
            >
              {kids()}
            </span>
          )
          break
        }

        // A channel link. Never navigates either - it moves the client to
        // that buffer, which is the whole reason a raw <#id> was rewritten
        // into one. Rendered as a span rather than an anchor so no browser
        // ever sees a "channel:" href to make sense of.
        const channel = href.match(/^channel:(.+)$/)
        if (channel) {
          const target = decodeURIComponent(channel[1])
          out.push(
            <span
              key={key}
              className={className}
              role="button"
              tabIndex={0}
              title="Open this channel"
              onClick={() => onOpenChannel?.(target)}
              onKeyDown={(e) => e.key === 'Enter' && onOpenChannel?.(target)}
            >
              {kids()}
            </span>
          )
          break
        }

        // A link to a channel is acted on here rather than handed straight to
        // the OS. What that means differs by service: an irc: link belongs to
        // this client alone, while a kick.com link is a web page as well as a
        // channel, so following it opens the stream in the browser *and* the
        // chat here - see the store's followDeepLink.
        if (isDeepLink(href)) {
          out.push(
            <a
              key={key}
              href={href}
              onClick={(e) => {
                e.preventDefault()
                onOpenLink?.(href)
              }}
            >
              {kids()}
            </a>
          )
          break
        }

        // Only real web links are clickable. Anything else (javascript:,
        // data:, a custom app scheme) renders as inert text - main re-checks
        // the scheme before handing anything to the OS, so this is the first
        // of two gates, not the only one.
        if (/^(https?|file):/i.test(href)) {
          out.push(
            <a
              key={key}
              href={href}
              onClick={(e) => {
                e.preventDefault()
                void window.moho.openExternal(href)
              }}
            >
              {kids()}
            </a>
          )
        } else {
          out.push(<span key={key}>{kids()}</span>)
        }
        break
      }

      case 'SPAN': {
        // IRC's formatting codes arrive as inline styles on a span (see
        // format.ts's ircFormat), so the four properties they can produce are
        // read back here - each against its own pattern, because a style
        // attribute from a message is somebody else's text.
        const style = safeSpanStyle(el.getAttribute('style'))
        out.push(
          <span key={key} className={className} style={style}>
            {kids()}
          </span>
        )
        break
      }

      case 'STRONG':
      case 'B':
        out.push(<b key={key}>{kids()}</b>)
        break
      case 'EM':
      case 'I':
        out.push(<i key={key}>{kids()}</i>)
        break
      case 'U':
        out.push(<u key={key}>{kids()}</u>)
        break
      case 'STRIKE':
      case 'S':
      // Matrix's own spelling of the same thing.
      case 'DEL':
        out.push(<s key={key}>{kids()}</s>)
        break

      // Structure. These need cases of their own and not just a place on the
      // whitelist: the switch has no default, so a tag allowed through
      // without one renders as nothing at all - its children included.
      case 'P':
        out.push(<p key={key}>{kids()}</p>)
        break
      case 'CODE':
        out.push(
          <code key={key} className={className}>
            {kids()}
          </code>
        )
        break
      case 'PRE':
        out.push(<pre key={key}>{kids()}</pre>)
        break
      case 'BLOCKQUOTE':
        out.push(<blockquote key={key}>{kids()}</blockquote>)
        break
      case 'UL':
        out.push(<ul key={key}>{kids()}</ul>)
        break
      case 'OL':
        out.push(<ol key={key}>{kids()}</ol>)
        break
      case 'LI':
        out.push(<li key={key}>{kids()}</li>)
        break
      // A heading inside a chat line is emphasis, not document structure -
      // rendering one at heading size would tower over the conversation
      // around it.
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6':
        out.push(<b key={key}>{kids()}</b>)
        break
    }
  })

  return out
}

function CustomEmoji({ src, alt }: { src: string; alt: string }): JSX.Element {
  const [gone, setGone] = useState(false)
  if (gone) return <span className="custom-emoji-gone">{alt}</span>
  return (
    <img
      src={src}
      className="custom-emoji"
      alt={alt}
      title={alt}
      onError={() => setGone(true)}
    />
  )
}

function classNameOf(el: Element): string | undefined {
  const kept = (el.getAttribute('class') || '')
    .split(/\s+/)
    .filter((c) => ALLOWED_CLASSES.has(c))
  return kept.length ? kept.join(' ') : undefined
}

/**
 * Smilies are bundled local files and nobilis's cached media are local paths;
 * both go through the guarded moho-media scheme. Remote https images are
 * allowed too (Discord CDN avatars and the like). Everything else is dropped.
 */
function safeImageSrc(src: string): string | null {
  if (/^https:\/\//i.test(src)) return src
  // Already routed (a smilie url built by the store) - passing it through
  // resolveMediaUrl again would double-wrap it.
  if (src.startsWith(`${MEDIA_SCHEME}://`)) return src
  if (/^(file:\/\/|\/)/.test(src)) return resolveMediaUrl(src)
  return null
}
