import { useEffect, useMemo, useRef, useState } from 'react'
import { useEscapeLayer } from '../lib/layers'
import { createPortal } from 'react-dom'
import { Icon, IconButton } from './Icon'
import { galleryAround, stepIndex } from '../lib/gallery'
import { actualSize, clampView, FIT, wheelFactor, zoomAt, type View } from '../lib/zoompan'

export interface LightboxSource {
  kind: 'image' | 'video'
  /** Already resolved for display - a moho-media:// path or a remote URL. */
  src: string
  /** The original remote link, for opening outside the app. */
  externalUrl?: string
  filename?: string
  /** Intrinsic size when known, so the zoom control can say whether there is
      anything to zoom into. */
  width?: number
  height?: number
  /** Shown in the header, matching the message the media came from. */
  from?: string
  loop?: boolean
}

interface Props {
  source: LightboxSource
  /**
   * The element in the log this was opened from. With it the viewer can step
   * to the other pictures and videos beside it in the conversation.
   */
  anchor?: HTMLElement | null
  onClose: () => void
}

/**
 * Full-window viewer for one picture or video, in a portal at the document
 * root so it escapes the message list's scrolling and clipping.
 *
 * Deliberately protocol-agnostic: it is handed a resolved `src` and knows
 * nothing about where it came from, so a Matrix image fetched to the local
 * cache, a Sneedchat attachment pulled over Tor and a Discord CDN link all
 * open the same way.
 */
export function Lightbox({ source: opened, anchor = null, onClose }: Props): JSX.Element {
  // Who is beside it, worked out once on opening: scrolling the log behind the
  // viewer should not change what the arrows reach.
  const gallery = useMemo(() => galleryAround<LightboxSource>(anchor), [anchor])
  const [index, setIndex] = useState(gallery?.index ?? 0)
  const first = gallery?.index ?? 0
  // The one opened is the one the log hands over as it changes (its full-size
  // picture may arrive after the viewer is up); the others are asked for.
  const source = gallery && index !== first ? gallery.items[index]() : opened
  const count = gallery?.items.length ?? 1

  const [view, setView] = useState<View>(FIT)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')
  const dragging = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  useEscapeLayer(onClose)

  const step = (by: 1 | -1): void => {
    if (!gallery) return
    const next = stepIndex(index, count, by)
    if (next === null) return
    setIndex(next)
    setView(FIT)
    setNatural(null)
    setNote('')
  }

  // How big the picture is drawn at rest, and the window it is drawn in: what
  // zooming and panning are measured against.
  const measure = (): { fitted: { w: number; h: number }; stage: { w: number; h: number } } | null => {
    const img = imgRef.current
    const stage = stageRef.current
    if (!img || !stage) return null
    return { fitted: { w: img.offsetWidth, h: img.offsetHeight }, stage: { w: stage.clientWidth, h: stage.clientHeight } }
  }
  /** A point in the window, given from its middle. */
  const fromCentre = (clientX: number, clientY: number): { x: number; y: number } => {
    const r = stageRef.current!.getBoundingClientRect()
    return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) }
  }
  const zoomBy = (factor: number, at = { x: 0, y: 0 }): void => {
    const m = measure()
    if (m) setView((v) => zoomAt(v, factor, at, m.fitted, m.stage))
  }

  // The wheel zooms where the pointer is. Native rather than React's own, as
  // it has to cancel the scroll, which a passive listener cannot.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || source.kind !== 'image') return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      zoomBy(wheelFactor(e.deltaY, e.ctrlKey), fromCentre(e.clientX, e.clientY))
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // A video being scrubbed uses the arrows itself.
      if (e.target instanceof HTMLVideoElement || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'ArrowRight') step(1)
      else if (source.kind === 'image' && (e.key === '+' || e.key === '=')) zoomBy(1.5)
      else if (source.kind === 'image' && (e.key === '-' || e.key === '_')) zoomBy(1 / 1.5)
      else if (e.key === '0') setView(FIT)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /** One click goes in to actual size at the pointer, and the next comes back out. */
  const toggleZoom = (e: React.MouseEvent): void => {
    const m = measure()
    if (!m) return
    if (view.scale > 1) setView(FIT)
    else zoomBy(natural ? actualSize(natural, m.fitted) : 2, fromCentre(e.clientX, e.clientY))
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (view.scale <= 1) return
    dragging.current = { x: e.clientX - view.x, y: e.clientY - view.y, moved: false }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const d = dragging.current
    const m = measure()
    if (!d || !m) return
    const x = e.clientX - d.x
    const y = e.clientY - d.y
    if (Math.abs(x - view.x) + Math.abs(y - view.y) > 2) d.moved = true
    setView(clampView({ scale: view.scale, x, y }, m.fitted, m.stage))
  }
  const onPointerUp = (): void => {
    dragging.current = null
  }

  const openExternal = (): void => {
    void window.moho.openExternal(source.externalUrl || source.src)
  }

  /**
   * Saves to the configured downloads folder (the system one unless changed
   * in Settings). Prefers the original over what is on screen: the displayed
   * source may be a downscaled preview, and nobody wants to save the thumbnail.
   */
  const download = (): void => {
    if (saving) return
    setSaving(true)
    setNote('')
    void window.moho
      .downloadMedia(source.externalUrl || source.src, source.filename)
      .then((res) => setNote(res.error ? `Couldn't save: ${res.error}` : `Saved to ${res.path}`))
      .catch((e: Error) => setNote(`Couldn't save: ${e.message}`))
      .finally(() => setSaving(false))
  }

  /**
   * Puts the picture on the clipboard. From its pixels where the page may read
   * them - which is every picture it drew from this app's own cache - and from
   * where it lives where it may not (a remote image taints the canvas).
   */
  const copyImage = (): void => {
    const img = imgRef.current
    let pixels: string | undefined
    try {
      if (img && img.naturalWidth) {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        canvas.getContext('2d')?.drawImage(img, 0, 0)
        pixels = canvas.toDataURL('image/png')
      }
    } catch {
      pixels = undefined
    }
    void window.moho
      .copyImage(source.externalUrl || source.src, pixels)
      .then((res) => setNote(res.error ? `Couldn't copy: ${res.error}` : 'Copied the picture'))
      .catch((e: Error) => setNote(`Couldn't copy: ${e.message}`))
  }

  const zoomed = view.scale > 1

  return createPortal(
    // Clicking the backdrop closes; the media and toolbar stop that
    // themselves, so a click that lands on either is never a dismissal.
    <div className="lightbox-backdrop" onMouseDown={onClose}>
      <div className="lightbox-bar" onMouseDown={(e) => e.stopPropagation()}>
        <span className="lightbox-title ellipsis">
          {source.from && <strong>{source.from}</strong>}
          {source.filename && <span className="small muted">{source.filename}</span>}
          {count > 1 && (
            <span className="small muted lightbox-count">
              {index + 1} / {count}
            </span>
          )}
          {note && <span className={`small lightbox-saved ellipsis${/^Couldn't/.test(note) ? ' failed' : ''}`}>{note}</span>}
        </span>
        <span className="lightbox-actions">
          {source.kind === 'image' && (
            <>
              <IconButton name="zoom_out" size={20} title="Zoom out (-)" disabled={!zoomed} onClick={() => zoomBy(1 / 1.5)} />
              <button
                type="button"
                className="lightbox-level small"
                title={zoomed ? 'Back to fit (0)' : 'Fitted to the window'}
                disabled={!zoomed}
                onClick={() => setView(FIT)}
              >
                {Math.round(view.scale * 100)}%
              </button>
              <IconButton name="zoom_in" size={20} title="Zoom in (+, or the wheel)" onClick={() => zoomBy(1.5)} />
              <IconButton name="content_copy" size={20} title="Copy the picture" onClick={copyImage} />
            </>
          )}
          <IconButton
            name={saving ? 'hourglass_empty' : 'download'}
            size={20}
            title={note || 'Save to your downloads folder'}
            disabled={saving}
            onClick={download}
          />
          <IconButton name="open_in_new" size={20} title="Open outside moho" onClick={openExternal} />
          <IconButton name="close" size={20} title="Close (Esc)" onClick={onClose} />
        </span>
      </div>

      {/* The stage fills the backdrop, so it must not stop the click itself -
          the empty space around the media is part of "outside", and clicking
          there closes. Only the media and the toolbar hold their clicks. */}
      <div ref={stageRef} className={`lightbox-stage${zoomed ? ' zoomed' : ''}`}>
        {source.kind === 'video' ? (
          <video
            key={index}
            className="lightbox-media"
            src={source.src}
            controls
            autoPlay
            loop={source.loop}
            // Reaching for the scrubber must not dismiss the video.
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          <img
            key={index}
            ref={imgRef}
            className="lightbox-media"
            src={source.src}
            alt={source.filename || ''}
            draggable={false}
            style={zoomed ? { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` } : undefined}
            onLoad={(e) =>
              setNatural({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight
              })
            }
            onClick={(e) => {
              // The end of a drag is not a click on the picture.
              if (dragging.current?.moved) return
              toggleZoom(e)
            }}
            // The picture itself is not "outside": clicking it zooms.
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        )}
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            className="lightbox-nav prev"
            title="Previous (←)"
            aria-label="Previous"
            disabled={index === 0}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => step(-1)}
          >
            <Icon name="chevron_left" size={32} />
          </button>
          <button
            type="button"
            className="lightbox-nav next"
            title="Next (→)"
            aria-label="Next"
            disabled={index === count - 1}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => step(1)}
          >
            <Icon name="chevron_right" size={32} />
          </button>
        </>
      )}
    </div>,
    document.body
  )
}
