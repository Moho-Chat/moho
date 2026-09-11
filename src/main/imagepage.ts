/**
 * Reading a page to find out which picture it is showing.
 *
 * Its own file, and free of anything Electron, so the parsing can be exercised
 * against the pages of real image hosts without standing up a window - which
 * is the only way to know that a tag written by somebody else's template is
 * one this actually matches.
 */

/**
 * How much of a page to read before giving up on finding the tag.
 *
 * The tag being looked for is in `<head>`, so a page that has not named its
 * picture in the first half megabyte is not going to. The cap is the point:
 * this reads a document from a host nobody here controls, and "read until it
 * ends" is a promise about somebody else's server.
 */
const MAX_PAGE_BYTES = 512 * 1024

export async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < MAX_PAGE_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
  }
  await reader.cancel().catch(() => {})
  return Buffer.concat(chunks).subarray(0, MAX_PAGE_BYTES).toString('utf8')
}

/**
 * The picture a page says it is showing.
 *
 * Matched rather than parsed because this process has no DOM and the answer is
 * one attribute: the tags are machine-written by the host's own template, and
 * the shapes that vary between hosts are the attribute order and the quoting,
 * both of which this allows for. A page that says nothing recognisable gives
 * nothing, and the thumbnail stays.
 */
export function pictureNamedIn(html: string, page: URL): string | null {
  const head = html.split(/<\/head>/i)[0]
  const names = ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']
  for (const name of names) {
    const tag = new RegExp(
      `<meta[^>]+(?:property|name)\\s*=\\s*["']${name}["'][^>]*>`,
      'i'
    ).exec(head)
    if (!tag) continue
    const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag[0])?.[1]
    if (!content) continue
    try {
      const found = new URL(content, page)
      // https only: the viewer showing it is a window in this app, and a
      // plaintext picture in it would be a plaintext request made by it.
      if (found.protocol === 'https:') return found.toString()
    } catch {
      // Somebody else's markup naming something that is not a URL is not an
      // error here; it is simply not an answer.
    }
  }
  return null
}
