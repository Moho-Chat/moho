import type { ReactNode } from 'react'
import { MEDIA_SCHEME, resolveMediaUrl } from './util'

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

const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SPAN', 'A', 'IMG', 'BR'])

/**
 * Tags whose text content is markup rather than prose. Everything else that
 * isn't whitelisted degrades to its text (so <div>hi</div> still shows "hi"),
 * but doing that for these would paint raw script source into the message.
 */
const DROP_CONTENT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED'])

/** Only the classes format.ts itself emits; anything else is dropped. */
const ALLOWED_CLASSES = new Set(['inline-code', 'spoiler', 'revealed', 'smilie'])

/** Hex or a plain CSS colour keyword - nothing that could carry a url() or expression. */
const SAFE_COLOR = /^#[0-9a-f]{3,8}$|^[a-z]{3,20}$/i

export interface RichTextProps {
  html: string
  /** Called with the spoiler's index when a hidden run is clicked. */
  onRevealSpoiler?: (index: number) => void
}

export function RichText({ html, onRevealSpoiler }: RichTextProps): JSX.Element {
  // DOMParser builds an inert document: no scripts run, no images load, no
  // network requests happen during parsing.
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  return <>{walk(doc.body, onRevealSpoiler, 0)}</>
}

function walk(node: Node, onRevealSpoiler: RichTextProps['onRevealSpoiler'], depth: number): ReactNode[] {
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
    const kids = (): ReactNode[] => walk(el, onRevealSpoiler, depth + 1)

    switch (el.tagName) {
      case 'BR':
        out.push(<br key={key} />)
        break

      case 'IMG': {
        const src = el.getAttribute('src') || ''
        const resolved = safeImageSrc(src)
        if (resolved) {
          out.push(
            <img key={key} src={resolved} className={className} alt={el.getAttribute('alt') || ''} />
          )
        }
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
        const color = el.getAttribute('style')?.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)?.[1]?.trim()
        const style = color && SAFE_COLOR.test(color) ? { color } : undefined
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
        out.push(<s key={key}>{kids()}</s>)
        break
    }
  })

  return out
}

function classNameOf(el: Element): string | undefined {
  const kept = (el.getAttribute('class') || '')
    .split(/\s+/)
    .filter((c) => ALLOWED_CLASSES.has(c))
  return kept.length ? kept.join(' ') : undefined
}

/**
 * Smilies are bundled local files and chatd's cached media are local paths;
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
