import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from './Icon'

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
export function Lightbox({ source, onClose }: Props): JSX.Element {
  const [zoomed, setZoomed] = useState(false)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState('')
  const dragging = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Zooming a picture that is already smaller than the window would only
  // blur it, so the control is offered only when there is detail to reveal.
  const size = natural ?? (source.width && source.height ? { w: source.width, h: source.height } : null)
  const canZoom =
    source.kind === 'image' &&
    !!size &&
    (size.w > window.innerWidth * 0.92 || size.h > window.innerHeight * 0.86)

  const toggleZoom = (): void => {
    if (!canZoom) return
    setPan({ x: 0, y: 0 })
    setZoomed((z) => !z)
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (!zoomed) return
    dragging.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const d = dragging.current
    if (!d) return
    setPan({ x: e.clientX - d.x, y: e.clientY - d.y })
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
    setSaved('')
    void window.moho
      .downloadMedia(source.externalUrl || source.src, source.filename)
      .then((res) => setSaved(res.error ? `Couldn't save: ${res.error}` : `Saved to ${res.path}`))
      .catch((e: Error) => setSaved(`Couldn't save: ${e.message}`))
      .finally(() => setSaving(false))
  }

  return createPortal(
    // Clicking the backdrop closes; the media and toolbar stop that
    // themselves, so a click that lands on either is never a dismissal.
    <div className="lightbox-backdrop" onMouseDown={onClose}>
      <div className="lightbox-bar" onMouseDown={(e) => e.stopPropagation()}>
        <span className="lightbox-title ellipsis">
          {source.from && <strong>{source.from}</strong>}
          {source.filename && <span className="small muted">{source.filename}</span>}
          {saved && <span className="small lightbox-saved ellipsis">{saved}</span>}
        </span>
        <span className="lightbox-actions">
          {canZoom && (
            <IconButton
              name={zoomed ? 'zoom_out' : 'zoom_in'}
              size={20}
              title={zoomed ? 'Fit to window' : 'Zoom to full size'}
              onClick={toggleZoom}
            />
          )}
          <IconButton
            name={saving ? 'hourglass_empty' : 'download'}
            size={20}
            title={saved || 'Save to your downloads folder'}
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
      <div className={`lightbox-stage${zoomed ? ' zoomed' : ''}`}>
        {source.kind === 'video' ? (
          <video
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
            className="lightbox-media"
            src={source.src}
            alt={source.filename || ''}
            style={zoomed ? { transform: `translate(${pan.x}px, ${pan.y}px)` } : undefined}
            onLoad={(e) =>
              setNatural({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight
              })
            }
            onClick={toggleZoom}
            // The picture itself is not "outside": clicking it zooms.
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        )}
      </div>
    </div>,
    document.body
  )
}
