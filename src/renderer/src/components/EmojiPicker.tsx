import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { resolveMediaUrl } from '../lib/util'
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

interface Props {
  anchor: HTMLElement | null
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

  // Grouped in the order the daemon listed them, so a channel's own emotes
  // stay above the global sets rather than being alphabetised away from where
  // whoever is watching expects them.
  const customSections = useMemo<[string, CustomEmoji[]][]>(() => {
    const groups: [string, CustomEmoji[]][] = []
    for (const e of custom) {
      const title = e.set ?? 'Server emoji'
      const found = groups.find(([t]) => t === title)
      if (found) found[1].push(e)
      else groups.push([title, [e]])
    }
    return groups
  }, [custom])
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

      <div className="emoji-scroll">
        {!stickersOnly && !q && recent.length > 0 && (
          <Section title="Recent">
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
          <Section title="Emoji">
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
      </div>
    </div>,
    document.body
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <>
      <div className="emoji-section small muted">{title}</div>
      <div className="emoji-grid">{children}</div>
    </>
  )
}
