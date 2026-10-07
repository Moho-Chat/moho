/**
 * Formatting in the message box: what each service can carry, and how the
 * box's contents become the markup that service reads.
 *
 * The box shows formatting as it will look (bold is bold), and holds it as
 * elements. What leaves it is a different matter per service: Discord reads
 * Markdown, Matrix a small subset of it, Sneedchat BBCode, IRC control
 * characters, and Kick reads none. `serialize` is that translation; the rest
 * of the window never sees the markup.
 */
import { MIRC_COLOURS } from './format'

export type FormatKind = 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'spoiler' | 'quote' | 'color'

/**
 * What each service can say. Only what its protocol, or the daemon on its
 * behalf, actually carries: offering Matrix an underline the daemon would
 * send as literal characters is a button that makes a mess.
 */
const CAPABILITIES: Record<string, FormatKind[]> = {
  discord: ['bold', 'italic', 'underline', 'strike', 'code', 'spoiler', 'quote'],
  // markup.rs in the daemon: bold, italic, strike and code.
  matrix: ['bold', 'italic', 'strike', 'code'],
  sneedchat: ['bold', 'italic', 'underline', 'strike', 'code', 'spoiler', 'quote', 'color'],
  // Quote is left out of IRC: a quote is a line of its own, and a newline
  // reaching IRC is a malformed message.
  irc: ['bold', 'italic', 'underline', 'strike', 'code', 'spoiler', 'color']
}

export function formatsFor(service: string | undefined): FormatKind[] {
  return (service && CAPABILITIES[service]) || []
}

export const FORMAT_LABELS: Record<FormatKind, string> = {
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strike: 'Strikethrough',
  code: 'Code',
  spoiler: 'Spoiler',
  quote: 'Quote',
  color: 'Colour'
}

/** The colours offered, which are IRC's sixteen: the only palette it has. */
export const PALETTE = MIRC_COLOURS

/** The minimum of a DOM node that serialising needs, so it can be tested without one. */
export interface BoxNode {
  nodeType: number
  nodeValue: string | null
  nodeName: string
  childNodes: ArrayLike<BoxNode>
  dataset?: Record<string, string | undefined>
}

const TEXT_NODE = 3
const ELEMENT_NODE = 1

/** Which format an element stands for, if it is one: ours, or the browser's own. */
function kindOf(node: BoxNode): FormatKind | null {
  switch (node.nodeName) {
    case 'B':
    case 'STRONG':
      return 'bold'
    case 'I':
    case 'EM':
      return 'italic'
    case 'U':
      return 'underline'
    case 'S':
    case 'STRIKE':
    case 'DEL':
      return 'strike'
    default: {
      const fmt = node.dataset?.fmt
      return fmt && fmt in FORMAT_LABELS ? (fmt as FormatKind) : null
    }
  }
}

const IRC = {
  bold: '\u0002',
  italic: '\u001d',
  underline: '\u001f',
  strike: '\u001e',
  mono: '\u0011',
  colour: '\u0003'
}

/** The palette index nearest a colour, for IRC, which can only say a number. */
function ircColour(hex: string): string {
  let best = 1
  let bestDistance = Infinity
  const want = hex.replace('#', '').padStart(6, '0')
  const channel = (h: string, i: number): number => parseInt(h.slice(i, i + 2), 16)
  MIRC_COLOURS.forEach((candidate, index) => {
    const have = candidate.replace('#', '')
    const d = [0, 2, 4].reduce((sum, i) => sum + (channel(want, i) - channel(have, i)) ** 2, 0)
    if (d < bestDistance) {
      bestDistance = d
      best = index
    }
  })
  return String(best).padStart(2, '0')
}

/** A run of backticks longer than any inside, so the code cannot end early. */
function codeFence(inner: string): [string, string] {
  const longest = Math.max(0, ...(inner.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longest + 1)
  const pad = inner.startsWith('`') || inner.endsWith('`') ? ' ' : ''
  return [fence + pad, pad + fence]
}

/**
 * One format applied to already-serialised text, in a service's own markup.
 * Whitespace at either end is kept outside the markers: Markdown does not
 * read `** bold**` as bold.
 */
export function wrap(service: string | undefined, kind: FormatKind, inner: string, colour?: string): string {
  if (!inner.trim()) return inner
  const lead = inner.match(/^\s*/)?.[0] ?? ''
  const trail = inner.match(/\s*$/)?.[0] ?? ''
  const core = inner.slice(lead.length, inner.length - trail.length)
  const marked = (open: string, close = open): string => `${lead}${open}${core}${close}${trail}`
  const markdown = service === 'discord' || service === 'matrix'

  if (service === 'sneedchat') {
    switch (kind) {
      case 'bold': return marked('[b]', '[/b]')
      case 'italic': return marked('[i]', '[/i]')
      case 'underline': return marked('[u]', '[/u]')
      case 'strike': return marked('[s]', '[/s]')
      case 'code': return marked('[code]', '[/code]')
      case 'spoiler': return marked('[spoiler]', '[/spoiler]')
      case 'quote': return marked('[quote]', '[/quote]')
      case 'color': return colour ? marked(`[color=${colour}]`, '[/color]') : inner
    }
  }
  if (service === 'irc') {
    switch (kind) {
      case 'bold': return marked(IRC.bold)
      case 'italic': return marked(IRC.italic)
      case 'underline': return marked(IRC.underline)
      case 'strike': return marked(IRC.strike)
      case 'code': return marked(IRC.mono)
      // Foreground and background the same: unreadable until selected, which
      // is how IRC has always hidden a spoiler.
      case 'spoiler': return marked(`${IRC.colour}01,01`, IRC.colour)
      case 'color': {
        if (!colour) return inner
        // A digit or ",digit" right after a colour number would be read as
        // part of it, so an empty bold toggle is put between.
        const guard = /^[,\d]/.test(core) ? IRC.bold + IRC.bold : ''
        return marked(`${IRC.colour}${ircColour(colour)}${guard}`, IRC.colour)
      }
      default: return inner
    }
  }
  if (markdown) {
    switch (kind) {
      case 'bold': return marked('**')
      case 'italic': return marked('*')
      case 'strike': return marked('~~')
      case 'code': {
        const [open, close] = codeFence(core)
        return marked(open, close)
      }
      case 'underline': return service === 'discord' ? marked('__') : inner
      case 'spoiler': return service === 'discord' ? marked('||') : inner
      case 'quote': {
        if (service !== 'discord') return inner
        // A quote is a line of its own on Discord, however it was typed.
        const quoted = core.split('\n').map((line) => `> ${line}`).join('\n')
        return `${lead}\n${quoted}\n${trail}`
      }
      default: return inner
    }
  }
  return inner
}

/**
 * What the box holds, as the text to send for `service`.
 *
 * An emoji leaves as its token; a format leaves as that service's markup, if
 * the service has it and a format already open around it has not said the same
 * thing (bold inside bold is bold once).
 */
export function serialize(root: BoxNode, service: string | undefined): string {
  const allowed = new Set(formatsFor(service))
  const walk = (node: BoxNode, open: Set<string>): string => {
    let out = ''
    for (let i = 0; i < node.childNodes.length; i++) {
      const n = node.childNodes[i]
      if (n.nodeType === TEXT_NODE) {
        out += n.nodeValue ?? ''
      } else if (n.nodeName === 'IMG') {
        out += n.dataset?.token ?? ''
      } else if (n.nodeName === 'BR') {
        out += '\n'
      } else if (n.nodeType === ELEMENT_NODE) {
        const kind = kindOf(n)
        const colour = n.dataset?.color
        const key = kind === 'color' ? `color:${colour}` : kind
        if (!kind || !allowed.has(kind) || (key && open.has(key))) {
          out += walk(n, open)
          continue
        }
        const inside = new Set(open)
        inside.add(key as string)
        out += wrap(service, kind, walk(n, inside), colour)
      }
    }
    return out
  }
  return walk(root, new Set())
}
