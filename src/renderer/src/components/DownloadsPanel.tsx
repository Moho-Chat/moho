import { useEffect, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import { useChat, useStore } from '../state/hooks'
import { formatRelativeTime } from '../lib/util'
import { humanRate, humanSize, looksExecutable, TransferBar } from './TransferPanel'
import type { DccTransfer } from '../../../shared/wire'

/**
 * Everything that has been offered: what is arriving, and what arrived.
 *
 * The floating cards are for answering an offer and watching the first minute
 * of it; this is where a transfer goes when it is put away, and where it stays
 * afterwards. So the two are deliberately not the same list filtered
 * differently - a card is a question, and a row here is a record.
 *
 * It is also the history's own page (#339): where files go is said first,
 * with the way there; a finished file is opened or shown in its folder from
 * its row; and a row is taken off the list one at a time or by kind. Clearing
 * never touches a file - it forgets that a transfer happened.
 *
 * Reached from the cog rather than from a conversation, because a download
 * belongs to the person rather than to the channel it happened to be offered
 * in - by the time it matters, which channel that was is rarely the thing
 * being looked for.
 */
/** Which of the list is being looked at. */
type Shown = 'all' | 'active' | 'finished' | 'failed'

const settled = (t: DccTransfer): boolean => t.state === 'done' || t.state === 'declined' || t.state === 'failed'
const unsuccessful = (t: DccTransfer): boolean => t.state === 'declined' || t.state === 'failed'
const DAY = 86_400

export function DownloadsPanel(): JSX.Element {
  const store = useStore()
  const transfers = useChat((s) => s.transfers)
  const [folder, setFolder] = useState('')
  const [shown, setShown] = useState<Shown>('all')
  const [clearing, setClearing] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    void window.moho
      .rpc<{ resolvedDirectory?: string }>('getDccPrefs')
      .then((p) => setFolder(p.resolvedDirectory ?? ''))
      .catch(() => undefined)
  }, [])

  const active = transfers.filter((t) => !settled(t))
  const finished = transfers.filter(settled)
  const now = Math.floor(Date.now() / 1000)
  const count = {
    failed: finished.filter(unsuccessful).length,
    done: finished.filter((t) => t.state === 'done').length,
    week: finished.filter((t) => t.startedAt && t.startedAt < now - 7 * DAY).length,
    month: finished.filter((t) => t.startedAt && t.startedAt < now - 30 * DAY).length
  }

  const earlier =
    shown === 'failed' ? finished.filter(unsuccessful) : shown === 'finished' ? finished.filter((t) => t.state === 'done') : shown === 'active' ? [] : finished
  const moving = shown === 'all' || shown === 'active' ? active : []

  // What clearing did, said: the list getting shorter is not an answer where
  // nothing matched, and "files that are gone" is counted by the daemon.
  const clear = (what: Parameters<typeof store.forgetTransfers>[0], nothing: string): void => {
    void store.forgetTransfers(what).then((n) => store.toast('info', n ? `Cleared ${n} from the list. The files are where they were.` : nothing))
  }
  const openFolder = (): void => {
    void window.moho.transferFile('folder').then((r) => r.error && store.toast('error', r.error))
  }

  const with_ = (n: number, label: string): string => (n ? `${label} (${n})` : label)
  const clearEntries: MenuEntry[] = [
    { heading: 'Clear from this list' },
    { label: with_(count.failed, 'Failed and declined'), icon: 'error', disabled: !count.failed, onClick: () => clear({ which: 'failed' }, 'Nothing failed or was declined.') },
    { label: with_(count.done, 'Finished'), icon: 'check_circle', disabled: !count.done, onClick: () => clear({ which: 'finished' }, 'Nothing has finished.') },
    // Moved, renamed or deleted since: only the daemon can look, so it is not counted here.
    { label: 'Whose file is no longer there', icon: 'draft', disabled: !count.done, onClick: () => clear({ which: 'missing' }, 'Every finished file is still where it was saved.') },
    { separator: true },
    { label: with_(count.week, 'Older than a week'), icon: 'history', disabled: !count.week, onClick: () => clear({ which: 'all', olderThanDays: 7 }, 'Nothing is that old.') },
    { label: with_(count.month, 'Older than 30 days'), icon: 'history', disabled: !count.month, onClick: () => clear({ which: 'all', olderThanDays: 30 }, 'Nothing is that old.') },
    { separator: true },
    { label: with_(finished.length, 'Everything'), icon: 'delete_sweep', danger: true, disabled: !finished.length, onClick: () => clear({ which: 'all' }, 'There is nothing to clear.') }
  ]

  const tabs: { id: Shown; label: string; n: number }[] = [
    { id: 'all', label: 'All', n: transfers.length },
    { id: 'active', label: 'In progress', n: active.length },
    { id: 'finished', label: 'Finished', n: count.done },
    { id: 'failed', label: 'Failed', n: count.failed }
  ]

  return (
    <div className="settings">
      <div className="settings-content">
        <div data-page="downloads" className="downloads">
          <header className="page-head downloads-head">
            <div className="page-head-text">
              <h2 className="page-title">Downloads</h2>
              {/* First, and with the way there beside it: where a file went is
                  the question this page is opened to answer (#339). */}
              {folder && (
                <p className="page-sub downloads-folder">
                  <span className="ellipsis">
                    Files are saved to{' '}
                    <span className="selectable" title={folder}>
                      {folder}
                    </span>
                  </span>
                </p>
              )}
            </div>
            <button type="button" className="button quiet" onClick={openFolder}>
              <Icon name="folder_open" size={16} /> Open folder
            </button>
            <button
              type="button"
              className="button quiet"
              disabled={finished.length === 0}
              aria-haspopup="menu"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setClearing({ x: r.right - 250, y: r.bottom + 4 })
              }}
            >
              <Icon name="delete_sweep" size={16} /> Clear…
            </button>
          </header>

          {transfers.length === 0 ? (
            <div className="placeholder muted">
              <Icon name="download" size={32} />
              <span>No files have come or gone yet</span>
              <span className="small">
                On IRC, people and XDCC bots can send you a file directly, and you can send one back - from a name in the
                member list, or from something they said. moho asks before taking one.
              </span>
            </div>
          ) : (
            <>
              <div className="downloads-bar">
                <div className="setting-segmented" role="tablist" aria-label="Which transfers">
                  {tabs.map((t) => (
                    <button key={t.id} type="button" role="tab" aria-selected={shown === t.id} className={shown === t.id ? 'active' : undefined} onClick={() => setShown(t.id)}>
                      {t.label}
                      <span className="downloads-count">{t.n}</span>
                    </button>
                  ))}
                </div>
                <span className="small muted">Removing a line takes it off this list. The file stays where it is.</span>
              </div>

              {moving.length > 0 && (
                <section className="settings-section">
                  <h4 className="settings-section-title section-label">In progress</h4>
                  <div className="downloads-list">
                    {moving.map((t) => (
                      <Row key={t.id} transfer={t} />
                    ))}
                  </div>
                </section>
              )}

              {earlier.length > 0 && (
                <section className="settings-section">
                  <h4 className="settings-section-title section-label">Earlier</h4>
                  <div className="downloads-list">
                    {earlier.map((t) => (
                      <Row key={t.id} transfer={t} />
                    ))}
                  </div>
                </section>
              )}

              {moving.length === 0 && earlier.length === 0 && <p className="small muted downloads-none">Nothing here.</p>}
            </>
          )}
        </div>
      </div>
      {clearing && <ContextMenu x={Math.max(8, clearing.x)} y={clearing.y} entries={clearEntries} onClose={() => setClearing(null)} />}
    </div>
  )
}

function Row({ transfer }: { transfer: DccTransfer }): JSX.Element {
  const store = useStore()
  const running = transfer.state === 'receiving' || transfer.state === 'sending'
  // Only an offer somebody made to us is a question we can answer.
  const offered = transfer.state === 'offered' && !transfer.outgoing
  const waiting = transfer.state === 'offered' && transfer.outgoing
  // An export can be put down between pages and picked back up. A DCC socket
  // cannot, which is why this is offered on one and not the other rather than
  // on everything that happens to be running.
  const isExport = transfer.kind === 'export'
  const paused = transfer.state === 'paused'
  // Something on disk to open: what arrived, or what was written.
  const onDisk = transfer.state === 'done' && !!transfer.path

  const file = (action: 'open' | 'reveal'): void => {
    // A program is not opened on a click: it is shown where it is, and running it is somebody's own decision.
    if (action === 'open' && looksExecutable(transfer.fileName)) {
      if (!window.confirm(`${transfer.fileName} looks like a program. Opening it runs it.\n\nRun it?`)) return
    }
    void window.moho.transferFile(action, transfer.id).then((r) => r.error && store.toast('error', r.error))
  }

  return (
    <div className="download-row">
      <span className={`download-mark ${transfer.state}`}>
        <Icon name={markFor(transfer)} size={18} />
      </span>

      <div className="download-text">
        <div className="ellipsis download-name" title={transfer.fileName}>
          {transfer.fileName}
        </div>
        <div className="small muted download-detail">
          <span className="download-from">
            {isExport ? 'export of' : transfer.outgoing ? 'to' : 'from'} {transfer.from}
          </span>
          {/* Titled as well as shown, because the whole of a long failure is
              worth being able to read even where it has been wrapped. */}
          <span className="download-status" title={describe(transfer)}>
            {describe(transfer)}
          </span>
          {settled(transfer) && !!transfer.startedAt && <span className="download-when">{formatRelativeTime(transfer.startedAt)}</span>}
        </div>
        {(running || paused) && <TransferBar transfer={transfer} />}
      </div>

      <div className="download-actions">
        {offered && (
          <button type="button" className="button primary" onClick={() => void store.acceptTransfer(transfer.id)}>
            Accept
          </button>
        )}
        {/* Only while there is something to stop. A finished row has nothing
            this button could do, and one that did nothing would still look
            like it might delete the file. */}
        {isExport && (running || paused) && (
          <IconButton
            name={paused ? 'play_arrow' : 'pause'}
            title={paused ? 'Carry on with this export' : 'Put this export down for now'}
            onClick={() => void store.pauseTransfer(transfer.id, !paused)}
          />
        )}
        {(running || paused || offered || waiting) && (
          <IconButton
            name="close"
            title={
              offered
                ? 'Decline this file'
                : waiting
                  ? 'Withdraw this offer'
                  : isExport
                    ? 'Stop this export - what has been written is kept'
                    : 'Cancel this transfer'
            }
            className="calling"
            onClick={() => void store.cancelTransfer(transfer.id)}
          />
        )}
        {onDisk && <IconButton name="open_in_new" title="Open the file" onClick={() => file('open')} />}
        {onDisk && <IconButton name="folder_open" title="Show it in its folder" onClick={() => file('reveal')} />}
        {/* A line of history, which is all this takes away. */}
        {settled(transfer) && (
          <IconButton name="playlist_remove" title="Remove from this list - the file is not deleted" onClick={() => void store.forgetTransfers({ ids: [transfer.id] })} />
        )}
      </div>
    </div>
  )
}

function markFor(t: DccTransfer): string {
  if (t.kind === 'export' && t.state !== 'done' && t.state !== 'failed') return 'description'
  if (t.state === 'paused') return 'pause_circle'
  if (t.state === 'done') return 'check_circle'
  if (t.state === 'failed') return 'error'
  if (t.state === 'declined') return 'block'
  if (t.state === 'offered') return t.outgoing ? 'schedule' : 'help'
  if (t.state === 'sending') return 'upload'
  return looksExecutable(t.fileName) ? 'warning' : 'download'
}

/** The one line that says where this transfer got to. */
function describe(t: DccTransfer): string {
  // An export is counted in messages, not bytes. Its `size` is how many the
  // range holds and may still be zero while the history is being reached back
  // through - which is why "so far" is said rather than a proportion of a
  // total that is not known yet.
  if (t.kind === 'export') {
    const done = t.received.toLocaleString()
    if (t.state === 'done') return `${done} messages`
    if (t.state === 'failed') return t.error ? `Failed - ${t.error}` : 'Failed'
    const where = t.size > 0 ? `${done} of ${t.size.toLocaleString()} messages` : `${done} messages so far`
    return t.state === 'paused' ? `${where} · paused` : where
  }
  switch (t.state) {
    case 'receiving':
    case 'sending': {
      const rate = humanRate(t.rate)
      const moved = `${humanSize(t.received)} of ${humanSize(t.size)}`
      return rate ? `${moved} · ${rate}` : moved
    }
    case 'paused':
      return `${humanSize(t.received)} of ${humanSize(t.size)} · paused`
    case 'offered':
      return `${humanSize(t.size)} · ${t.outgoing ? 'waiting for them to accept' : 'waiting for an answer'}`
    case 'done':
      return humanSize(t.size)
    // The reason matters more than the word: "failed" on its own sends
    // somebody looking through logs for what this line could have told them.
    case 'failed':
      return t.error ? `Failed - ${t.error}` : 'Failed'
    default:
      return t.error ? `Declined - ${t.error}` : 'Declined'
  }
}
