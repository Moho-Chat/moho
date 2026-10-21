/**
 * The web search engines "Search for…" can send selected text to. Each is a
 * template with `%s` where the (percent-encoded) query goes; the person picks
 * one in Settings > General, or gives a template of their own.
 */
export interface SearchEngine {
  id: string
  label: string
  /** Where the query goes; `%s` is replaced. Empty for the custom entry, whose template is the person's own. */
  template: string
}

export const SEARCH_ENGINES: SearchEngine[] = [
  { id: 'duckduckgo', label: 'DuckDuckGo', template: 'https://duckduckgo.com/?q=%s' },
  { id: 'google', label: 'Google', template: 'https://www.google.com/search?q=%s' },
  { id: 'bing', label: 'Bing', template: 'https://www.bing.com/search?q=%s' },
  { id: 'brave', label: 'Brave Search', template: 'https://search.brave.com/search?q=%s' },
  { id: 'startpage', label: 'Startpage', template: 'https://www.startpage.com/do/search?q=%s' },
  { id: 'ecosia', label: 'Ecosia', template: 'https://www.ecosia.org/search?q=%s' },
  { id: 'qwant', label: 'Qwant', template: 'https://www.qwant.com/?q=%s' },
  { id: 'yandex', label: 'Yandex', template: 'https://yandex.com/search/?text=%s' },
  { id: 'kagi', label: 'Kagi', template: 'https://kagi.com/search?q=%s' },
  { id: 'custom', label: 'Other…', template: '' }
]

export const DEFAULT_SEARCH_ENGINE = 'duckduckgo'

/** The longest query sent: a whole pasted wall of text is not a search, and a URL has limits. */
const MAX_QUERY = 300

/** A custom template is usable if it is a web address with a place for the query. */
export function validTemplate(template: string): boolean {
  return /^https?:\/\/[^\s%]+/i.test(template.trim()) && template.includes('%s')
}

/** What the person chose, as a template - or null if it is custom and not (yet) usable. */
function templateFor(engineId: string, custom: string): string | null {
  const engine = SEARCH_ENGINES.find((e) => e.id === engineId) ?? SEARCH_ENGINES[0]
  if (engine.id === 'custom') return validTemplate(custom) ? custom.trim() : null
  return engine.template
}

/** The name shown on the menu entry: the engine's, or the custom address's host. */
export function engineName(engineId: string, custom: string): string {
  const engine = SEARCH_ENGINES.find((e) => e.id === engineId) ?? SEARCH_ENGINES[0]
  if (engine.id !== 'custom') return engine.label
  try {
    return new URL(custom.trim().replace('%s', 'x')).hostname.replace(/^www\./, '') || 'the web'
  } catch {
    return 'the web'
  }
}

/** The query as it will be sent: one line, trimmed, and not absurdly long. */
export function cleanQuery(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > MAX_QUERY ? one.slice(0, MAX_QUERY).trimEnd() : one
}

/** The address to open to search for `text`, or null if there is nothing to search for or nowhere to send it. */
export function searchUrl(text: string, engineId: string, custom = ''): string | null {
  const query = cleanQuery(text)
  const template = templateFor(engineId, custom)
  if (!query || !template) return null
  // Split rather than replaced: a `$&` in the query is not a replacement pattern.
  return template.split('%s').join(encodeURIComponent(query))
}

/** A selection shortened to fit a menu entry. */
export function shortened(text: string, max = 28): string {
  const one = cleanQuery(text)
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one
}
