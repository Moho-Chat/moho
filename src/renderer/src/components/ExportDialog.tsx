import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { classes } from '../lib/util'
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

/** How far back, as the choices most exports are: everything, or the last while. Custom is the two fields. */
type Span = 'all' | '7d' | '30d' | 'year' | 'custom'

const SPANS: { id: Span; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'year', label: 'This year' },
  { id: 'custom', label: 'Custom' }
]

/** Where a span starts, in unix seconds; 0 is the beginning. */
export function spanStart(span: Exclude<Span, 'custom'>, now = new Date()): number {
  if (span === 'all') return 0
  if (span === 'year') return Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000)
  const start = new Date(now)
  start.setDate(start.getDate() - (span === '7d' ? 7 : 30))
  start.setHours(0, 0, 0, 0)
  return Math.floor(start.getTime() / 1000)
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
  onConfirm: (range: ExportRange, opts: { media: boolean; into?: string }) => void
  onCancel: () => void
}): JSX.Element {
  const [span, setSpan] = useState<Span>('all')
  const everything = span === 'all'
  const custom = span === 'custom'
  // Where it will be written: where downloads go, unless another folder is chosen for this one.
  const [folder, setFolder] = useState('')
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  useEffect(() => {
    void window.moho.prefs
      .getAll()
      .then(async (prefs) => setFolder((prefs['downloads.directory'] as string | undefined) || (await window.moho.defaultDownloadDir())))
      .catch(() => {})
  }, [])
  const [from, setFrom] = useState('')
  // Local time, not UTC: the fields are read and typed by somebody sitting in
  // their own timezone, and `toISOString` would offer them a "now" that is not
  // theirs. Sliced to minutes because that is what datetime-local carries.
  const [to, setTo] = useState(() => localNow())
  const [media, setMedia] = useState(true)


  // A datetime-local value is already local wall-clock time, so `new Date` on
  // it means what was typed. Seconds are not offered, so the start is taken at
  // :00 and the end at :59 - an inclusive minute at each edge, which is what
  // somebody choosing "to 14:30" means rather than "up to 14:30:00 exactly".
  const since = !custom ? spanStart(span) : !from ? 0 : Math.floor(new Date(`${from}:00`).getTime() / 1000)
  const until = !custom || !to ? Math.floor(Date.now() / 1000) : Math.floor(new Date(`${to}:59`).getTime() / 1000)
  const ready = !custom || (!!to && (!from || since < until))

  // Only worth saying where it would actually bite: a range that starts after
  // what is already held needs nothing fetched.
  const wouldReachBack = !everything && !!oldestHeld && since > 0 && since < oldestHeld
  const shortfall = wouldReachBack && !canReachBack(service)

  return (
    <Modal title={`Export ${title}`} icon="download" onClose={onCancel} className="reason-prompt export-dialog">
        <div className="export-field">
          <span className="section-label">How far back</span>
          <div className="segmented export-spans" role="radiogroup" aria-label="How far back">
            {SPANS.map((choice) => (
              <button
                key={choice.id}
                type="button"
                role="radio"
                aria-checked={span === choice.id}
                className={span === choice.id ? 'active' : undefined}
                onClick={() => setSpan(choice.id)}
              >
                {choice.label}
              </button>
            ))}
          </div>
          {custom && (
            <div className="export-range">
              <label>
                <span className="small muted">From</span>
                <input type="datetime-local" className="text-field" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                <span className="small muted">To</span>
                <input type="datetime-local" className="text-field" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
          )}
        </div>

        <div className="export-field">
          <span className="section-label">What goes in</span>
          <div className="switch-row export-switch">
            <span className="switch-text">
              <span>Pictures and video</span>
              <span className="small muted">Slower, but the export still reads offline</span>
            </span>
            <button type="button" role="switch" aria-checked={media} className={classes('switch', media && 'on')} onClick={() => setMedia(!media)}>
              <span className="switch-knob" />
            </button>
          </div>
        </div>

        <div className="export-field">
          <span className="section-label">Where</span>
          <div className="export-where">
            <Icon name="folder" size={18} />
            <span className="ellipsis export-where-path" title={chosen ?? folder}>
              {chosen ?? (folder || 'Your downloads folder')}
            </span>
            <button
              type="button"
              className="button quiet"
              onClick={() => void window.moho.pickDirectory().then((dir) => dir && setChosen(dir))}
            >
              Change…
            </button>
          </div>
          <span className="small muted">A folder of HTML, the way the conversation looks here. It is listed in Settings → Downloads while it is written and after.</span>
        </div>

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
          <button type="button" className="button subtle" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!ready}
            onClick={() => onConfirm({ since, until }, { media, into: chosen })}
          >
            Export
          </button>
        </div>
    </Modal>
  )
}
