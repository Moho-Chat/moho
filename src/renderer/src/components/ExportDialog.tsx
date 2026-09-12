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
/**
 * Now, as a `datetime-local` field wants it: local wall-clock, to the minute.
 *
 * Not `toISOString().slice(...)`, which is UTC - that would offer somebody in
 * Sydney a "now" ten hours behind the clock on their wall, and they would fix
 * it by hand without ever being told why it was wrong.
 */
function localNow(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ExportDialog({
  title,
  service,
  oldestHeld,
  heldCount,
  onConfirm,
  onCancel
}: {
  title: string
  service?: string
  /** Unix seconds of the oldest message held locally, if there is one. */
  oldestHeld?: number
  /**
   * How many messages are already here. A floor rather than a total: an export
   * that reaches back will fetch more, so this is the smallest it can be.
   */
  heldCount?: number
  onConfirm: (range: ExportRange, opts: { media: boolean }) => void
  onCancel: () => void
}): JSX.Element {
  const [everything, setEverything] = useState(true)
  const [from, setFrom] = useState('')
  // Local time, not UTC: the fields are read and typed by somebody sitting in
  // their own timezone, and `toISOString` would offer them a "now" that is not
  // theirs. Sliced to minutes because that is what datetime-local carries.
  const [to, setTo] = useState(() => localNow())
  const [media, setMedia] = useState(true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  // A datetime-local value is already local wall-clock time, so `new Date` on
  // it means what was typed. Seconds are not offered, so the start is taken at
  // :00 and the end at :59 - an inclusive minute at each edge, which is what
  // somebody choosing "to 14:30" means rather than "up to 14:30:00 exactly".
  const since = everything || !from ? 0 : Math.floor(new Date(`${from}:00`).getTime() / 1000)
  const until = everything || !to ? Math.floor(Date.now() / 1000) : Math.floor(new Date(`${to}:59`).getTime() / 1000)
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
              <input
                type="datetime-local"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              <span className="small muted">To</span>
              <input
                type="datetime-local"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
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

        {/* Said before it starts rather than discovered afterwards. There is
            no size limit on what an export downloads - that was asked for
            deliberately - so the only protection against a surprise is
            knowing beforehand, and the number here is the honest one moho can
            give: what it already holds, which an export that reaches back will
            add to. */}
        <p className={everything ? 'small warn-text' : 'small muted'}>
          {everything ? (
            <>
              This exports the whole history of {title}. A long-running channel or an old
              conversation can be an <strong>extremely large</strong> export
              {typeof heldCount === 'number' && heldCount > 0 ? (
                <> — moho already holds {heldCount.toLocaleString()} messages here</>
              ) : null}
              {canReachBack(service) ? ', and more will be fetched from the service.' : '.'}
            </>
          ) : (
            <>
              Long ranges can still be large, especially with pictures and video — there is no
              size limit on what an export writes.
            </>
          )}
        </p>

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
