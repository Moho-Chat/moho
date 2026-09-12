import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { resolveMediaUrl } from '../lib/util'
import { Icon } from './Icon'
import { discordEmojiUrl, emojiPreview, type SmilieEntry } from '../lib/format'
import type { CustomEmoji } from '../../../shared/wire'

/**
 * Emoji insertion popup: a search box, then a small curated set of common
 * Unicode emoji (which work on every protocol, being just text), the active
 * buffer's guild custom emoji when it's a Discord channel, and Sneedchat's
 * bundled smiley table when it's a Sneedchat room.
 *
 * The Unicode set is deliberately not exhaustive - there are thousands - just
 * the categories that come up constantly in chat. Each entry carries search
 * keywords, since "fire" only finds 🔥 if something says so.
 */
const COMMON_EMOJI: { emoji: string; name: string }[] = [
  { emoji: '😀', name: 'grinning happy' },
  { emoji: '😂', name: 'joy laughing tears' },
  { emoji: '😅', name: 'sweat smile nervous' },
  { emoji: '😊', name: 'smiling blush' },
  { emoji: '😍', name: 'heart eyes love' },
  { emoji: '🤔', name: 'thinking hmm' },
  { emoji: '😐', name: 'neutral straight face' },
  { emoji: '🙄', name: 'eye roll' },
  { emoji: '😭', name: 'crying sob' },
  { emoji: '😡', name: 'angry rage mad' },
  { emoji: '🥺', name: 'pleading puppy eyes' },
  { emoji: '😎', name: 'cool sunglasses' },
  { emoji: '🤡', name: 'clown' },
  { emoji: '💀', name: 'skull dead dying' },
  { emoji: '👍', name: 'thumbs up yes approve' },
  { emoji: '👎', name: 'thumbs down no' },
  { emoji: '👏', name: 'clap applause' },
  { emoji: '🙏', name: 'pray thanks please' },
  { emoji: '🤝', name: 'handshake deal' },
  { emoji: '💪', name: 'muscle strong' },
  { emoji: '🫡', name: 'salute respect' },
  { emoji: '❤️', name: 'heart love red' },
  { emoji: '🔥', name: 'fire lit hot' },
  { emoji: '✨', name: 'sparkles shiny' },
  { emoji: '🎉', name: 'party tada celebrate' },
  { emoji: '⭐', name: 'star' },
  { emoji: '✅', name: 'check done yes' },
  { emoji: '❌', name: 'cross no wrong' },
  { emoji: '⚠️', name: 'warning caution' },
  { emoji: '👀', name: 'eyes looking' },
  { emoji: '🚀', name: 'rocket ship launch' },
  { emoji: '🍺', name: 'beer drink' },
  { emoji: '☕', name: 'coffee' },
  { emoji: '🐛', name: 'bug' },
  { emoji: '💩', name: 'poop' },
  { emoji: '🤖', name: 'robot bot' }
]

/**
 * The text that stands for an emoji in a message, in the form its own service
 * reads back.
 *
 * Kick's carries the id first and the name second, so a client that cannot
 * draw the picture still shows something readable; Discord's is the other way
 * round and flags animation. Neither is negotiable - the server parses it.
 */
function emojiToken(e: CustomEmoji): string {
  if (e.url) return `[emote:${e.id}:${e.name}]`
  return `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`
}

/** Where its picture is: said outright where the service gives one. */
function emojiImage(e: CustomEmoji): string {
  return e.url ?? discordEmojiUrl(e.id)
}

const MAX_RECENT = 16

/**
 * Where one account's recent picks are kept.
 *
 * Per account rather than one list for everything, because nothing in that
 * list is portable. A Sneedchat shortcode is meaningless on Discord, which
 * would send it as literal text. A Discord custom emoji belongs to a guild,
 * and whether a *particular* signed-in user may use one from a guild they are
 * not in depends on whether that user pays for Nitro - so even two Discord
 * accounts on this machine disagree about the same emoji. An account id
 * already names both the protocol and the user, which is exactly the grain
 * this needs.
 */
function recentKey(accountId?: string): string {
  return `emoji.recent:${accountId || 'none'}`
}

function readRecent(accountId?: string): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(recentKey(accountId)) || '[]')
    return Array.isArray(stored) ? stored : []
  } catch {
    return []
  }
}

/** One image out of a Matrix sticker pack, as the daemon offers it. */
export interface StickerEntry {
  name: string
  pack: string
  mxc: string
  body: string
  /** A local path the daemon already fetched, absent while it is fetching. */
  url?: string | null
}

/** One place emoji come from, as `listAllEmoji` answers. */
export interface EmojiSource {
  id: string
  name: string
  service: string
  /** "text" inserts into the message; "event" sends on its own. */
  kind: string
  iconUrl?: string
  /** Whether these can be sent in the conversation the picker was opened in. */
  usableHere: boolean
  emoji: {
    id: string
    name: string
    url?: string
    animated?: boolean
    /** Owned somewhere this account has not paid into. */
    locked?: boolean
  }[]
}

interface Props {
  anchor: HTMLElement | null
  /** Which conversation this is for, so the daemon can say what reaches it. */
  bufferId?: string
  customEmoji?: CustomEmoji[]
  smilies?: SmilieEntry[]
  /**
   * The account's stickers, where the service has them. Separate from the
   * emoji above because picking one *sends* rather than typing: a sticker is
   * a message, not a character in the box.
   */
  stickers?: StickerEntry[]
  onSticker?: (sticker: StickerEntry) => void
  /**
   * Stickers and nothing else, for the button that opens exactly those.
   *
   * The two are different gestures rather than two tabs of one: an emoji goes
   * into the line being written and a sticker *is* the message, so mixing
   * them in one list would make half the cells type and half of them send.
   */
  stickersOnly?: boolean
  /** Whose recent picks to show. Absent means no account, so none are kept. */
  accountId?: string
  onSelect: (text: string) => void
  onClose: () => void
}

export function EmojiPicker({
  anchor,
  bufferId,
  customEmoji = [],
  smilies = [],
  stickers = [],
  stickersOnly = false,
  accountId,
  onSelect,
  onSticker,
  onClose
}: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const [recent, setRecent] = useState<string[]>(() => readRecent(accountId))
  // Everything this account can send, wherever it came from. Asked of the
  // daemon rather than assembled here, because the answer depends on things
  // only it knows - a Nitro subscription, a Kick channel's standing.
  const [sources, setSources] = useState<EmojiSource[]>([])
  const scroll = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    if (stickersOnly || !bufferId) return
    void window.moho
      .rpc<EmojiSource[]>('listAllEmoji', { bufferId })
      // An older daemon has no such method; the buffer's own emoji below are
      // what this showed before it asked, so that is what it falls back to.
      .catch(() => [])
      .then(setSources)
  }, [bufferId, stickersOnly])

  // The picker is normally opened fresh, but it stays up across a buffer
  // switch - and that switch can cross from one account to another, at which
  // point the list on screen belongs to somebody else.
  useEffect(() => {
    setRecent(readRecent(accountId))
  }, [accountId])

  // Anchored above and right-aligned to the button that opened it, then
  // clamped back inside the viewport once its real size is known.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !anchor) return
    const a = anchor.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.max(4, Math.min(a.right - r.width, window.innerWidth - r.width - 4)),
      top: Math.max(4, a.top - r.height - 6)
    })
  }, [anchor])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // Same capture-phase hazard as ContextMenu: dismissing on any mousedown
    // would unmount the cell before its click could land, so a press inside
    // the picker never selected anything. The anchor is excluded too, so the
    // button that opened this stays a clean toggle rather than closing here
    // and immediately reopening on its own click.
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      if (anchor?.contains(target)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onMouseDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onMouseDown, true)
    }
  }, [onClose, anchor])

  const q = query.trim().toLowerCase()

  const unicode = useMemo(
    () => (q ? COMMON_EMOJI.filter((e) => e.name.includes(q) || e.emoji === q) : COMMON_EMOJI),
    [q]
  )
  const custom = useMemo(
    () => (q ? customEmoji.filter((e) => e.name.toLowerCase().includes(q)) : customEmoji),
    [q, customEmoji]
  )

  // The sources the daemon listed, filtered by the search but never
  // reordered: a section's place is how somebody finds it again, and the jump
  // strip above is drawn from this same order.
  //
  // A source that belongs somewhere else and cannot be sent from here is
  // dropped entirely. Somewhere else's emoji are not an offer - they are a
  // list of things that would not work, and on an account in thirty Discord
  // guilds or twenty Kick channels that list is the picker.
  //
  // A locked entry inside a source that *does* belong here is the opposite,
  // and stays: a subscriber emote in the channel you are reading is a real
  // offer, and greying it out is how somebody finds out what subscribing to
  // this streamer would buy. The difference is whether the answer is "not
  // yours" or "not here".
  const sourceSections = useMemo(
    () =>
      sources
        .filter((src) => src.usableHere)
        .map((src) => ({
          ...src,
          emoji: q ? src.emoji.filter((e) => e.name.toLowerCase().includes(q)) : src.emoji
        }))
        .filter((src) => src.emoji.length > 0),
    [sources, q]
  )

  // Kept for a daemon too old to answer `listAllEmoji`, which is the only
  // case this still runs in - `customEmoji` is the buffer's own list.
  const customSections = useMemo<[string, CustomEmoji[]][]>(() => {
    if (sources.length > 0) return []
    const groups: [string, CustomEmoji[]][] = []
    for (const e of custom) {
      const title = e.set ?? 'Server emoji'
      const found = groups.find(([t]) => t === title)
      if (found) found[1].push(e)
      else groups.push([title, [e]])
    }
    return groups
  }, [custom, sources])

  const jumpTo = (id: string): void => {
    sectionRefs.current[id]?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  const smilieList = useMemo(
    () =>
      q
        ? smilies.filter(
            (s) => s.label.toLowerCase().includes(q) || s.aliases.some((a) => a.toLowerCase().includes(q))
          )
        : smilies,
    [q, smilies]
  )

  // Grouped by the pack they came from, which is how somebody remembers where
  // a sticker was: "the cat one" is a pack before it is a picture.
  const packs = useMemo(() => {
    const matching = q
      ? stickers.filter((s) => s.name.toLowerCase().includes(q) || s.pack.toLowerCase().includes(q))
      : stickers
    const byPack = new Map<string, StickerEntry[]>()
    for (const sticker of matching) {
      const list = byPack.get(sticker.pack) ?? []
      list.push(sticker)
      byPack.set(sticker.pack, list)
    }
    return [...byPack.entries()]
  }, [q, stickers])

  const pick = (text: string): void => {
    const next = [text, ...recent.filter((r) => r !== text)].slice(0, MAX_RECENT)
    setRecent(next)
    try {
      localStorage.setItem(recentKey(accountId), JSON.stringify(next))
    } catch {
      /* a full or disabled store just means recents don't persist */
    }
    onSelect(text)
  }

  return createPortal(
    <div
      ref={ref}
      className="emoji-picker"
      style={{ left: pos.left, top: pos.top }}
    >
      <input
        className="text-field"
        autoFocus
        placeholder={stickersOnly ? 'Search stickers…' : 'Search emoji…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {/* One icon per section, to move down a list that is now long enough
          to need it. Recent first because it is the one people reach for
          most, and it is where the list starts. */}
      {sourceSections.length > 0 && (
        <div className="emoji-jump">
          {!q && recent.length > 0 && (
            <button type="button" className="emoji-jump-tab" title="Recent" onClick={() => jumpTo('recent')}>
              <Icon name="history" size={16} />
            </button>
          )}
          {sourceSections.map((src) => (
            <button
              key={src.id}
              type="button"
              className="emoji-jump-tab"
              title={src.name}
              onClick={() => jumpTo(src.id)}
            >
              {src.iconUrl ? (
                <img src={resolveMediaUrl(src.iconUrl)} alt="" />
              ) : (
                <span className="emoji-jump-initial">{src.name.slice(0, 1).toUpperCase()}</span>
              )}
            </button>
          ))}
          <button type="button" className="emoji-jump-tab" title="Emoji" onClick={() => jumpTo('unicode')}>
            <Icon name="mood" size={16} />
          </button>
        </div>
      )}

      <div className="emoji-scroll" ref={scroll}>
        <PickerScroll.Provider value={scroll}>
        {!stickersOnly && !q && recent.length > 0 && (
          <Section title="Recent" anchorRef={(el) => (sectionRefs.current.recent = el)}>
            {recent.map((r) => {
              // A recent is stored as the text that gets sent, which for a
              // custom emoji or a shortcode is a stand-in rather than the
              // thing. Resolved back to a picture here, so the row of recents
              // looks like the rows above it rather than a column of tokens.
              const preview = emojiPreview(r, smilies)
              // A Unicode emoji is its own picture and shows at full size; a
              // stand-in that resolved to nothing is a shortcode, and every
              // shortcode has colons in it where an emoji character has none.
              const token = !preview && r.includes(':')
              return (
                <button
                  key={r}
                  type="button"
                  className={token ? 'emoji-cell emoji-token' : 'emoji-cell'}
                  title={preview?.label || r}
                  onClick={() => pick(r)}
                >
                  {preview ? (
                    <img src={resolveMediaUrl(preview.src)} alt={preview.label} />
                  ) : (
                    r
                  )}
                </button>
              )
            })}
          </Section>
        )}

        {sourceSections.map((src) => (
          <Section
            key={src.id}
            title={src.name}
            anchorRef={(el) => (sectionRefs.current[src.id] = el)}
          >
            {src.emoji.map((e) => {
              // Only one reason left: a source that could not be used here
              // at all was dropped above, so a cell that cannot be pressed is
              // one this account has not paid for - in a room it is reading.
              const why = e.locked ? `${e.name} — subscriber only` : ''
              return (
                <button
                  key={`${src.id}:${e.id}`}
                  type="button"
                  className={why ? 'emoji-cell locked' : 'emoji-cell'}
                  disabled={!!why}
                  title={why || e.name}
                  onClick={() => pick(e.id)}
                >
                  {e.url ? (
                    <img src={resolveMediaUrl(e.url)} alt={e.name} loading="lazy" />
                  ) : src.service === 'discord' ? (
                    <img src={discordEmojiUrl(e.id, 48)} alt={e.name} loading="lazy" />
                  ) : (
                    <span className="emoji-token">{e.name}</span>
                  )}
                </button>
              )
            })}
          </Section>
        ))}

        {packs.map(([pack, entries]) => (
          <Section key={pack} title={pack}>
            {entries.map((sticker) => (
              <button
                key={sticker.mxc}
                type="button"
                className="emoji-cell sticker-cell"
                title={`${sticker.name} · ${pack}`}
                onClick={() => onSticker?.(sticker)}
              >
                {sticker.url ? (
                  <img src={resolveMediaUrl(sticker.url)} alt={sticker.name} />
                ) : (
                  sticker.name
                )}
              </button>
            ))}
          </Section>
        ))}

        {stickersOnly && packs.length === 0 && (
          <p className="small muted emoji-empty">
            No sticker packs on this account. Packs added in another client - your own, or
            one a room shares - turn up here.
          </p>
        )}

        {!stickersOnly && unicode.length > 0 && (
          <Section title="Emoji" anchorRef={(el) => (sectionRefs.current.unicode = el)}>
            {unicode.map((e) => (
              <button
                key={e.emoji}
                type="button"
                className="emoji-cell"
                title={e.name}
                onClick={() => pick(e.emoji)}
              >
                {e.emoji}
              </button>
            ))}
          </Section>
        )}

        {/* One section per set where the service supplies sets, which Kick
            does - a channel's own emotes and Kick's global ones are worth
            telling apart, since an unfamiliar name is then attributable to
            whoever supplied it. Discord sends none, so its emoji stay under
            the one heading they always had. */}
        {!stickersOnly &&
          customSections.map(([title, list]) => (
          <Section key={title} title={title}>
            {list.map((e) => (
              <button
                key={e.id}
                type="button"
                className={`emoji-cell${e.locked ? ' locked' : ''}`}
                // A locked emote is shown and not offered. Sending it would
                // come back refused by Kick, and finding that out after
                // pressing send is worse than seeing it greyed out - while
                // hiding it entirely would leave no way to learn that
                // subscribing gets you anything.
                disabled={e.locked}
                title={e.locked ? `:${e.name}: - subscribers only` : `:${e.name}:`}
                // Each service's own inline form, since the server is what
                // renders it and it goes out as this literal text.
                onClick={() => pick(emojiToken(e))}
              >
                <img src={emojiImage(e)} alt={e.name} />
              </button>
            ))}
            </Section>
          ))}

        {!stickersOnly && smilieList.length > 0 && (
          <Section title="Smilies">
            {smilieList.map((s) => (
              <button
                key={s.file}
                type="button"
                className="emoji-cell"
                title={s.label}
                onClick={() => pick(s.aliases[0] || s.label)}
              >
                {s.url ? <img src={resolveMediaUrl(s.url)} alt={s.label} /> : s.aliases[0]}
              </button>
            ))}
          </Section>
        )}

        {unicode.length === 0 && custom.length === 0 && smilieList.length === 0 && (
          <div className="small muted emoji-empty">No matches.</div>
        )}
        </PickerScroll.Provider>
      </div>
    </div>,
    document.body
  )
}

/**
 * The scroller every Section measures itself against.
 *
 * A context rather than a prop threaded through seven call sites: a Section
 * needs to know where the visible part of the list is, and nothing else about
 * it does.
 */
const PickerScroll = createContext<React.RefObject<HTMLDivElement | null> | null>(null)

/** How many rows beyond the visible ones to build, so scrolling stays ahead. */
const OVERSCAN_ROWS = 2

/**
 * Cells built before anything has been measured.
 *
 * Four rather than a screenful: the measurement below needs one laid-out cell
 * to read a width and a height off, and the column count comes from the grid's
 * own width, not from counting cells. Building a screenful per section instead
 * meant every section fetched and decoded one before the window could close -
 * which for a few hundred animated GIFs is the whole cost this is here to
 * avoid, paid anyway in the first second.
 */
const BOOTSTRAP_CELLS = 4

/**
 * One heading and its grid, with only the rows near the viewport built.
 *
 * The picker offers every emoji the account can send, which on an account in a
 * few busy Kick channels is several hundred animated GIFs served at their full
 * size - 500x500 for something drawn at 26. Built all at once that cost ~284MB
 * of renderer memory, most of which Chromium's decoded-image cache never gave
 * back (see issue #211). Nothing here is a leak: the JS heap does not move.
 * It is simply that a decoded frame is enormous next to the cell it fills, and
 * the fix is to not decode the ones nobody is looking at.
 *
 * The outer div keeps the section's full height whatever is built inside it,
 * so every section below keeps its place and the scrollbar does not move as
 * rows come and go. The grid is then positioned at the first built row's
 * offset. Sizes are measured rather than hardcoded - `.emoji-cell` and
 * `.emoji-grid` own those numbers in app.css, and a copy of them here would
 * be a second place to change them and a silent misalignment when somebody
 * changed only one.
 */
function Section({
  title,
  children,
  anchorRef
}: {
  title: string
  children: React.ReactNode
  /** Where the jump strip scrolls to, for the sections that have a tab. */
  anchorRef?: (el: HTMLDivElement | null) => void
}): JSX.Element {
  const cells = useMemo(() => React.Children.toArray(children), [children])
  const scroll = useContext(PickerScroll)
  const windowRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  /** Columns, row height and row pitch, read off the laid-out grid. */
  const [metrics, setMetrics] = useState<{ cols: number; rowH: number; pitch: number } | null>(null)
  const [range, setRange] = useState<{ from: number; to: number }>({ from: 0, to: BOOTSTRAP_CELLS })

  useLayoutEffect(() => {
    const grid = gridRef.current
    const first = grid?.firstElementChild as HTMLElement | null
    if (!grid || !first) return
    const style = getComputedStyle(grid)
    const colGap = parseFloat(style.columnGap) || 0
    const rowGap = parseFloat(style.rowGap) || 0
    const cellW = first.offsetWidth
    const rowH = first.offsetHeight
    if (!cellW || !rowH) return
    const cols = Math.max(1, Math.round((grid.clientWidth + colGap) / (cellW + colGap)))
    setMetrics((was) =>
      was && was.cols === cols && was.rowH === rowH && was.pitch === rowH + rowGap
        ? was
        : { cols, rowH, pitch: rowH + rowGap }
    )
  }, [cells.length, range.from])

  const rows = metrics ? Math.ceil(cells.length / metrics.cols) : 0
  // The grid's own height, which the outer div holds whatever is built.
  const fullHeight = metrics && rows > 0 ? rows * metrics.rowH + (rows - 1) * (metrics.pitch - metrics.rowH) : undefined

  useEffect(() => {
    const box = scroll?.current
    const outer = windowRef.current
    if (!box || !outer || !metrics) return

    const recompute = (): void => {
      // Where this section sits relative to the visible part of the
      // scroller, and which of its rows the viewport is over.
      //
      // Measured rather than read off offsetTop: the picker is a positioned
      // element, so offsetParent is the picker itself rather than the
      // scroller, and offsetTop would be short by the height of the search
      // box and the jump strip above it - which silently builds the wrong
      // rows. Rects are relative to the same viewport for both, so their
      // difference is the honest answer.
      //
      // The result is stable frame to frame because the outer div's height
      // never depends on what is currently built.
      const top = outer.getBoundingClientRect().top - box.getBoundingClientRect().top
      const height = outer.offsetHeight

      // The slice of this section the viewport actually covers, in the
      // section's own coordinates. Clamped to the section at both ends, so a
      // section entirely above or below the viewport comes out empty.
      //
      // Getting this wrong is not subtle: taking max(0, -top) alone reads
      // every off-screen section as if the viewport sat at its first row, and
      // each one then builds a screenful it will never show. With a few
      // sections that is most of the cost this window exists to avoid.
      const from_y = Math.max(0, Math.min(height, -top))
      const to_y = Math.max(0, Math.min(height, -top + box.clientHeight))
      if (to_y <= from_y) {
        setRange((was) => (was.from === 0 && was.to === 0 ? was : { from: 0, to: 0 }))
        return
      }

      const firstRow = Math.max(0, Math.floor(from_y / metrics.pitch) - OVERSCAN_ROWS)
      const lastRow = Math.ceil(to_y / metrics.pitch) + OVERSCAN_ROWS
      const from = firstRow * metrics.cols
      const to = Math.min(cells.length, lastRow * metrics.cols)
      setRange((was) => (was.from === from && was.to === to ? was : { from, to }))
    }

    recompute()
    box.addEventListener('scroll', recompute, { passive: true })
    const ro = new ResizeObserver(recompute)
    ro.observe(box)
    return () => {
      box.removeEventListener('scroll', recompute)
      ro.disconnect()
    }
  }, [scroll, metrics, cells.length])

  const built = metrics ? cells.slice(range.from, range.to) : cells.slice(0, BOOTSTRAP_CELLS)
  const offset = metrics ? Math.floor(range.from / metrics.cols) * metrics.pitch : 0

  return (
    <>
      <div className="emoji-section small muted" ref={anchorRef}>
        {title}
      </div>
      <div ref={windowRef} className="emoji-grid-window" style={{ height: fullHeight }}>
        <div
          ref={gridRef}
          className="emoji-grid"
          style={metrics ? { transform: `translateY(${offset}px)` } : undefined}
        >
          {built}
        </div>
      </div>
    </>
  )
}
