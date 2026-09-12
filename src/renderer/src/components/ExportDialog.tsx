import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { canReachBack, type ExportRange } from '../lib/exporter'

/**
 * What to write to disk, and how far back.
 *
 * Defaults to everything, because that is what somebody usually means by
 * exporting a conversation; the range is for the one who knows they want
 * March. Dates rather than date-times: an export is measured in days, and two
 * clock fields to answer "last month" is four more than the question needs.
 *
 * The one thing this has to be honest about is what cannot be had.
 * `canReachBack` is the list of services that will give out history older than
 * what is already here - Sneedchat will not - and an export that quietly came
 * back short would read as a conversation that did not happen.
 */
export function ExportDialog({
  title,
  service,
  oldestHeld,
  onConfirm,
  onCancel
}: {
  title: string
  service?: string
  /** Unix seconds of the oldest message held locally, if there is one. */
  oldestHeld?: number
  onConfirm: (range: ExportRange, opts: { media: boolean }) => void
  onCancel: () => void
}): JSX.Element {
  const [everything, setEverything] = useState(true)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [media, setMedia] = useState(true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const since = everything || !from ? 0 : Math.floor(new Date(`${from}T00:00:00`).getTime() / 1000)
  // The end of the chosen day rather than its start - somebody asking for a
  // range ending today means today included, and midnight would drop it.
  const until = everything || !to ? Math.floor(Date.now() / 1000) : Math.floor(new Date(`${to}T23:59:59`).getTime() / 1000)
  const ready = everything || (!!to && (!from || since < until))

  // Only worth saying where it would actually bite: a range that starts after
  // what is already held needs nothing fetched.
  const wouldReachBack = !everything && !!oldestHeld && since > 0 && since < oldestHeld
  const shortfall = wouldReachBack && !canReachBack(service)

  return createPortal(
    <div className="lightbox-backdrop" onClick={onCancel}>
      <div className="reason-prompt" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="reason-prompt-head">
          <Icon name="download" size={18} />
          <span>Export {title}</span>
        </div>
        <p className="small muted">
          Written as a folder of HTML, the way it looks here, into your downloads.
        </p>

        <label className="export-choice">
          <input type="radio" checked={everything} onChange={() => setEverything(true)} />
          <span>Everything</span>
        </label>
        <label className="export-choice">
          <input type="radio" checked={!everything} onChange={() => setEverything(false)} />
          <span>A range</span>
        </label>

        {!everything && (
          <div className="export-range">
            <label>
              <span className="small muted">From</span>
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              <span className="small muted">To</span>
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
        )}

        <label className="export-choice">
          <input type="checkbox" checked={media} onChange={(e) => setMedia(e.target.checked)} />
          <span>
            Download pictures and video
            <span className="small muted"> — slower, but the export still reads offline</span>
          </span>
        </label>

        {shortfall && (
          <p className="small warn-text">
            This service cannot be asked for history older than what moho already holds, so
            anything before {new Date((oldestHeld ?? 0) * 1000).toLocaleDateString()} will not be
            in the export.
          </p>
        )}

        <div className="reason-prompt-actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="button"
            disabled={!ready}
            onClick={() => onConfirm({ since, until }, { media })}
          >
            Export
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
