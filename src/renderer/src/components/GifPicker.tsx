import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { useEscapeLayer } from '../lib/layers'
import { useMediaUrl } from '../lib/route'
import { useStore } from '../state/hooks'

/** One of the GIFs the daemon lists: what to play, and what to send. */
export interface GifEntry {
  id: string
  title: string
  /** The page on Tenor or Klipy, which is what Discord is sent. */
  url: string
  /** The video, to play in the grid. */
  src: string
  /** The file, which is what everything that is not Discord is sent. */
  gifSrc: string
  preview: string
  width: number
  height: number
}

interface GifCategory {
  name: string
  src: string
}

/** How long after the last keystroke before a search is made. */
const SEARCH_DELAY = 450

/**
 * GIFs to browse and send, as Discord's own picker has them: what is trending,
 * a search, and a row of categories to start from.
 *
 * They come from Discord - any account will do, whichever conversation this is
 * open in - and go anywhere: to a Discord conversation as the link Discord's
 * own client sends, so that Discord unfurls it; to every other service as the
 * file itself, which a window of this kind draws as the GIF and any other
 * client shows as a link.
 */
export function GifPicker({
  anchor,
  bufferId,
  accountId,
  discord,
  telegram,
  onClose
}: {
  anchor: HTMLElement | null
  bufferId: string
  accountId: string
  /** Whether the conversation is on Discord, which decides what is sent. */
  discord: boolean
  /** Whether the conversation is on Telegram, which has GIFs of its own: the account's saved ones, and its GIF search. */
  telegram?: boolean
  onClose: () => void
}): JSX.Element {
  const store = useStore()
  const media = useMediaUrl(accountId)
  const ref = useRef<HTMLDivElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState<GifEntry[]>([])
  const [categories, setCategories] = useState<GifCategory[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [error, setError] = useState('')

  useEscapeLayer(onClose)

  // Above and right-aligned to its button, and kept in view, as the emoji
  // picker is.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !anchor) return
    const place = (): void => {
      const a = anchor.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      const left = Math.max(4, Math.min(a.right - r.width, window.innerWidth - r.width - 4))
      const top = Math.max(4, Math.min(a.top - r.height - 6, window.innerHeight - r.height - 4))
      setPos((was) => (was.left === left && was.top === top ? was : { left, top }))
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [anchor])

  // Pressing anywhere else closes it; pressing inside, or on its button, does not.
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (ref.current?.contains(target) || anchor?.contains(target)) return
      onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [anchor, onClose])

  // What is trending when it opens, and a search once typing has stopped. An
  // answer that arrives after a newer question was asked is not shown.
  useEffect(() => {
    // The harness has no Discord to ask, so it can leave the answer here. Only
    // a window it started has the hook it is read from.
    const fixture = (window as unknown as { __mohoShots?: unknown; __gifFixture?: { gifs: GifEntry[]; categories: GifCategory[] } })
    if (fixture.__mohoShots && fixture.__gifFixture) {
      const wanted = query.trim().toLowerCase()
      setGifs(fixture.__gifFixture.gifs.filter((g) => !wanted || g.title.toLowerCase().includes(wanted)))
      setCategories(fixture.__gifFixture.categories)
      setState('ready')
      return
    }
    let current = true
    setState('loading')
    const wait = setTimeout(
      () => {
        window.moho
          .rpc<{ gifs: GifEntry[]; categories: GifCategory[] }>(telegram ? 'listTelegramGifs' : 'listGifs', telegram ? { bufferId, query: query.trim() } : { query: query.trim() })
          .then((answer) => {
            if (!current) return
            setGifs(answer.gifs)
            setCategories(answer.categories)
            setState('ready')
          })
          .catch((e: Error) => {
            if (!current) return
            setError(e.message)
            setState('failed')
          })
      },
      query.trim() ? SEARCH_DELAY : 0
    )
    return () => {
      current = false
      clearTimeout(wait)
    }
  }, [query, telegram, bufferId])

  const pick = (gif: GifEntry): void => {
    onClose()
    // Telegram's are files on Telegram: sending one is sending that file, not a link to it.
    if (telegram) {
      void window.moho.rpc('sendTelegramGif', { bufferId, id: gif.id }).catch((e: Error) => store.toast('error', e.message))
      return
    }
    // Discord's own client sends the link, which Discord turns into the GIF.
    // Everything else is sent the file, since a page address would be only
    // that.
    void store.sendMessage(bufferId, discord ? gif.url : gif.gifSrc)
  }

  // Two columns, each GIF into whichever is shorter, so differently shaped ones
  // fit together the way Discord's do.
  const columns: GifEntry[][] = [[], []]
  const heights = [0, 0]
  for (const gif of gifs) {
    const into = heights[0] <= heights[1] ? 0 : 1
    columns[into].push(gif)
    heights[into] += gif.width && gif.height ? gif.height / gif.width : 0.75
  }

  return createPortal(
    <div ref={ref} className="gif-picker" style={{ left: pos.left, top: pos.top }} role="dialog" aria-label="GIFs">
      <div className="gif-search">
        <Icon name="search" size={18} />
        <input
          autoFocus
          className="text-field"
          value={query}
          placeholder="Search for a GIF"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="gif-scroll" ref={scroll}>
        {!query.trim() && categories.length > 0 && (
          <div className="gif-categories">
            {categories.map((c) => (
              <button key={c.name} type="button" className="gif-category" onClick={() => setQuery(c.name)}>
                {c.name}
              </button>
            ))}
          </div>
        )}

        {state === 'failed' && <div className="gif-empty muted">{error || 'GIFs could not be loaded'}</div>}
        {state === 'loading' && gifs.length === 0 && <div className="gif-empty muted">Loading…</div>}
        {state === 'ready' && gifs.length === 0 && <div className="gif-empty muted">No GIFs found</div>}

        {gifs.length > 0 && (
          <div className="gif-grid">
            {columns.map((column, i) => (
              <div key={i} className="gif-column">
                {column.map((gif) => (
                  <GifCell key={gif.id} gif={gif} media={media} root={scroll} onPick={pick} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

/**
 * One GIF. Played only while it is on screen: a grid of forty videos all
 * running is a great deal of work for a list nobody is looking at the bottom
 * of, so out of view it is a still picture and nothing more.
 */
function GifCell({
  gif,
  media,
  root,
  onPick
}: {
  gif: GifEntry
  media: (url: string) => string
  root: React.RefObject<HTMLDivElement | null>
  onPick: (gif: GifEntry) => void
}): JSX.Element {
  const cell = useRef<HTMLButtonElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = cell.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { root: root.current, rootMargin: '80px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [root])
  const ratio = gif.width && gif.height ? `${gif.width} / ${gif.height}` : '4 / 3'
  return (
    <button ref={cell} type="button" className="gif-cell" title={gif.title} style={{ aspectRatio: ratio }} onClick={() => onPick(gif)}>
      {visible ? (
        <video src={media(gif.src)} poster={gif.preview ? media(gif.preview) : undefined} autoPlay loop muted playsInline />
      ) : gif.preview ? (
        <img src={media(gif.preview)} alt="" draggable={false} />
      ) : null}
    </button>
  )
}
