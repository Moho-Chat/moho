import { escapeHtml, extractMedia, formatMessage } from './format'
import { fileNameOf } from './util'
import type { Message } from '../../../shared/wire'

/**
 * Writing a conversation to disk, from this side of the split.
 *
 * The window renders and the daemon writes - see nobilis/src/export.rs for the
 * other half and why the line is drawn there. The short of it: the HTML a
 * message becomes is made here, by `formatMessage`, and an export is meant to
 * be what was on screen rather than a second opinion about it. So the loop
 * lives here, beside the formatter, and everything that is not formatting
 * happens on the far side of an RPC.
 *
 * Three passes, in order, because each needs the one before it:
 *
 * 1. **Reach back.** The range may run older than anything held locally, so
 *    older pages are pulled until the start of the range is covered or the
 *    service stops giving them out.
 * 2. **Read and render.** The range is walked forward in pages, each turned
 *    into HTML and handed over.
 * 3. **Seal it.** `index.html` is written last, so an unfinished export is
 *    visibly unfinished.
 */

/** How long to wait between asking a service for another page of history. */
const PAGE_PACE_MS = 400

/** How many pages back to ask for before giving up on reaching the start. */
const MAX_BACKFILL_PAGES = 400

/** How many messages to render at once. */
const RENDER_PAGE = 200

export interface ExportRange {
  /** Unix seconds, exclusive. Zero means "from the beginning". */
  since: number
  /** Unix seconds, inclusive. */
  until: number
}

export interface ExportTarget {
  bufferId: string
  accountId: string
  service?: string
  title: string
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Services that can be asked for history older than what is held.
 *
 * Sneedchat is the one that cannot: its history frame carries what the room
 * chose to send and there is no way to ask for more, so an export of a range
 * older than the local scrollback is the local scrollback. Saying so is the
 * point of this list - an export that quietly came back short would look like
 * a conversation that did not happen.
 */
const CAN_REACH_BACK = ['irc', 'matrix', 'discord', 'kick']

export function canReachBack(service: string | undefined): boolean {
  return !!service && CAN_REACH_BACK.includes(service)
}

/** What the daemon says about whether to keep going. */
interface Status {
  cancelled: boolean
  paused: boolean
  done: boolean
}

/**
 * Waits out a pause, and reports whether the job is still wanted.
 *
 * Polled rather than pushed because the loop is here and the flag is there;
 * an export between pages is a thing that can simply stop asking for a while.
 */
async function alive(rpc: Rpc, id: string): Promise<boolean> {
  for (;;) {
    const s = await rpc<Status>('exportStatus', { id })
    if (s.cancelled || s.done) return false
    if (!s.paused) return true
    await sleep(500)
  }
}

type Rpc = <T>(method: string, params?: Record<string, unknown>) => Promise<T>

/**
 * Pulls older pages until the range's start is covered.
 *
 * Uses the same `getBacklog` path scrolling up uses, which is what makes this
 * correct per service without a second implementation: Discord's snowflake
 * paging, Kick's cursor, IRC's CHATHISTORY and Matrix's `/messages` token are
 * each already behind it, with their own pacing.
 *
 * Stops on any of: the range covered, a page that reached no further back
 * (the conversation's own beginning), or the page budget. The budget is not a
 * guess about conversations - it is a guard against a service that answers
 * every request with the same page, which would otherwise loop forever.
 */
async function reachBack(
  rpc: Rpc,
  target: ExportTarget,
  range: ExportRange,
  id: string,
  onProgress: (pages: number) => void
): Promise<void> {
  if (!canReachBack(target.service)) return
  let oldest = Number.MAX_SAFE_INTEGER
  const held = await rpc<{ count: number; oldestHeld: number | null }>('countMessageRange', {
    bufferId: target.bufferId,
    after: 0,
    until: range.until
  })
  oldest = held.oldestHeld ?? range.until
  if (oldest <= range.since) return

  for (let page = 0; page < MAX_BACKFILL_PAGES; page++) {
    if (!(await alive(rpc, id))) return
    const rows = await rpc<Message[]>('getBacklog', {
      bufferId: target.bufferId,
      before: oldest,
      limit: 200
    })
    if (!rows.length) return
    const min = Math.min(...rows.map((m) => m.ts))
    // No further back than last time means the service has nothing older -
    // the conversation's own beginning, or the point its history stops.
    if (min >= oldest) return
    oldest = min
    onProgress(page + 1)
    if (min <= range.since) return
    await sleep(PAGE_PACE_MS)
  }
}

/**
 * One message, as the row it is on screen.
 *
 * Deliberately the same `formatMessage` the live log uses, with the same
 * options, so the export is the conversation rather than a description of it.
 * The media is rewritten to point inside the folder, which is the one way the
 * exported copy differs from the live one - and has to, or the page would go
 * blank the day the host expires it.
 */
async function renderMessage(
  rpc: Rpc,
  id: string,
  m: Message,
  service: string | undefined,
  localMedia: boolean
): Promise<string> {
  const when = new Date(m.ts * 1000)
  const stamp = when.toISOString().replace('T', ' ').slice(0, 19)
  const body = formatMessage(m.body ?? '', {
    isSneedchat: service === 'sneedchat',
    ircFormatting: service === 'irc' ? 'render' : 'strip'
  })

  // Anything the live view would have drawn as a picture or a video, from all
  // three places one can come from: linked in the body, attached to the
  // message, or carried by an embed. Fetched one at a time through the daemon,
  // which paces them - a conversation's worth of pictures is a burst at one
  // host.
  //
  // `path` before `url` for an attachment, deliberately. The local cache file
  // is the only route to media behind Tor, a Matrix access token or E2EE
  // decryption, and for those the remote URL is not fetchable at all - so
  // preferring it is the difference between an export with pictures in it and
  // one without.
  let media = ''
  if (localMedia) {
    const wanted: { url: string; kind: string }[] = []
    for (const item of extractMedia(m.body ?? '')) wanted.push({ url: item.url, kind: item.kind })
    for (const a of m.attachments ?? []) {
      const src = a.path || a.url
      if (src && a.kind !== 'file') wanted.push({ url: src, kind: a.kind })
    }
    const seen = new Set<string>()
    for (const item of wanted) {
      if (seen.has(item.url)) continue
      seen.add(item.url)
      const answer = await rpc<{ path: string }>('fetchExportMedia', { id, url: item.url })
      const src = escapeHtml(answer.path)
      const label = escapeHtml(fileNameOf(item.url))
      media +=
        item.kind === 'video'
          ? `<div><video controls src="${src}"></video></div>`
          : `<div><a href="${src}"><img loading="lazy" alt="${label}" src="${src}"></a></div>`
    }
  }

  // An embed is a card the live view draws around a link. Kept as text rather
  // than recreated: the point of the export is the conversation, and a title
  // and description say what the card said.
  let cards = ''
  for (const e of m.embeds ?? []) {
    const bits = [e.title, e.description].filter(Boolean).map((t) => escapeHtml(String(t)))
    if (!bits.length) continue
    const link = e.url ? ` <a href="${escapeHtml(e.url)}">${escapeHtml(e.url)}</a>` : ''
    cards += `<blockquote>${bits.join('<br>')}${link}</blockquote>`
  }

  const system = m.kind && m.kind !== 'chat' ? ' system' : ''
  const who = m.isAction ? `* ${m.from}` : m.from
  const edited = m.edited ? ' <span class="dim">(edited)</span>' : ''
  return (
    `<div class="msg${system}" id="m-${escapeHtml(m.id)}">` +
    `<time datetime="${when.toISOString()}">${escapeHtml(stamp)}</time>` +
    `<span class="who">${escapeHtml(who)}</span>` +
    `<span class="what">${body}${edited}${cards}${media}</span>` +
    `</div>\n`
  )
}

/**
 * Runs one export start to finish.
 *
 * Throws only for a failure worth surfacing; a cancel ends it quietly, because
 * somebody pressing cancel already knows what happened. The folder is left
 * either way - a half-finished export is sometimes exactly what was wanted.
 */
export async function runExport(
  rpc: Rpc,
  target: ExportTarget,
  range: ExportRange,
  into: string,
  opts: { media: boolean } = { media: true }
): Promise<{ id: string; path: string; messages: number }> {
  const started = await rpc<{ id: string; path: string }>('beginExport', {
    accountId: target.accountId,
    bufferId: target.bufferId,
    title: target.title,
    into
  })
  const id = started.id

  try {
    await reachBack(rpc, target, range, id, () => {})

    const held = await rpc<{ count: number }>('countMessageRange', {
      bufferId: target.bufferId,
      after: range.since,
      until: range.until
    })
    const total = held.count

    let after = range.since
    let done = 0
    for (;;) {
      if (!(await alive(rpc, id))) return { id, path: started.path, messages: done }
      const rows = await rpc<Message[]>('getMessageRange', {
        bufferId: target.bufferId,
        after,
        until: range.until,
        limit: RENDER_PAGE
      })
      if (!rows.length) break

      let html = ''
      for (const m of rows) html += await renderMessage(rpc, id, m, target.service, opts.media)
      done += rows.length
      await rpc('appendExport', { id, html, done, total })

      const last = rows[rows.length - 1].ts
      // A page that did not advance would loop forever. Only possible if more
      // than one page of messages share a timestamp to the second, which IRC
      // during a netsplit can genuinely manage.
      if (last <= after) break
      after = last
    }

    const subtitle = describeRange(range, done)
    await rpc('finishExport', { id, title: target.title, subtitle })
    return { id, path: started.path, messages: done }
  } catch (e) {
    await rpc('failExport', { id, reason: e instanceof Error ? e.message : String(e) }).catch(() => {})
    throw e
  }
}

/** The line under the title, saying what was asked for and what was found. */
export function describeRange(range: ExportRange, messages: number): string {
  const day = (ts: number): string => new Date(ts * 1000).toLocaleDateString()
  const span = range.since > 0 ? `${day(range.since)} to ${day(range.until)}` : `up to ${day(range.until)}`
  const count = messages === 1 ? '1 message' : `${messages.toLocaleString()} messages`
  return `${span} · ${count} · exported ${new Date().toLocaleString()}`
}
