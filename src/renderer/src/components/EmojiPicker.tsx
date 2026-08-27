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

const RECENT_KEY = 'emoji.recent'
const MAX_RECENT = 16

interface Props {
  anchor: HTMLElement | null
  customEmoji?: CustomEmoji[]
  smilies?: SmilieEntry[]
  onSelect: (text: string) => void
  onClose: () => void
}

export function EmojiPicker({ anchor, customEmoji = [], smilies = [], onSelect, onClose }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    } catch {
      return []
    }
  })

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
  const smilieList = useMemo(
    () =>
      q
        ? smilies.filter(
            (s) => s.label.toLowerCase().includes(q) || s.aliases.some((a) => a.toLowerCase().includes(q))
          )
        : smilies,
    [q, smilies]
  )

  const pick = (text: string): void => {
    const next = [text, ...recent.filter((r) => r !== text)].slice(0, MAX_RECENT)
    setRecent(next)
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
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
        placeholder="Search emoji…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="emoji-scroll">
        {!q && recent.length > 0 && (
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

        {unicode.length > 0 && (
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

        {custom.length > 0 && (
          <Section title="Server emoji">
            {custom.map((e) => (
              <button
                key={e.id}
                type="button"
                className="emoji-cell"
                title={`:${e.name}:`}
                // Discord's own inline form for a custom emoji; the server
                // renders it, so it must go out as this literal text.
                onClick={() => pick(`<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`)}
              >
                <img src={discordEmojiUrl(e.id)} alt={e.name} />
              </button>
            ))}
          </Section>
        )}

        {smilieList.length > 0 && (
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
