import { useEffect, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { useChat, useStore } from '../state/hooks'
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
 * Reached from the cog rather than from a conversation, because a download
 * belongs to the person rather than to the channel it happened to be offered
 * in - by the time it matters, which channel that was is rarely the thing
 * being looked for.
 */
export function DownloadsPanel(): JSX.Element {
  const transfers = useChat((s) => s.transfers)
  const [folder, setFolder] = useState('')

  useEffect(() => {
    void window.moho
      .rpc<{ resolvedDirectory?: string }>('getDccPrefs')
      .then((p) => setFolder(p.resolvedDirectory ?? ''))
      .catch(() => undefined)
  }, [])

  const active = transfers.filter((t) => t.state === 'offered' || t.state === 'receiving')
  const finished = transfers.filter((t) => t.state !== 'offered' && t.state !== 'receiving')

  return (
    <div className="settings">
      <div className="settings-content">
        {transfers.length === 0 ? (
          <div className="placeholder muted">
            <Icon name="download" size={32} />
            <span>Nothing has been offered to you yet</span>
            <span className="small">
              On IRC, people and XDCC bots can send you a file directly. moho asks before taking one.
            </span>
          </div>
        ) : (
          <>
            {active.length > 0 && (
              <section className="settings-section">
                <h4 className="settings-section-title">Arriving</h4>
                <div className="downloads-list">
                  {active.map((t) => (
                    <Row key={t.id} transfer={t} />
                  ))}
                </div>
              </section>
            )}

            {finished.length > 0 && (
              <section className="settings-section">
                <h4 className="settings-section-title">Earlier</h4>
                <div className="downloads-list">
                  {finished.map((t) => (
                    <Row key={t.id} transfer={t} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* At the foot rather than the head: it answers "where did it go",
            which is a question you have after looking at the list. */}
        {folder && (
          <p className="small muted downloads-folder ellipsis">
            Files are saved to <span title={folder}>{folder}</span>
          </p>
        )}
      </div>
    </div>
  )
}

function Row({ transfer }: { transfer: DccTransfer }): JSX.Element {
  const store = useStore()
  const running = transfer.state === 'receiving'
  const offered = transfer.state === 'offered'

  return (
    <div className="download-row">
      <span className={`download-mark ${transfer.state}`}>
        <Icon name={markFor(transfer)} size={18} />
      </span>

      <div className="download-text">
        <div className="ellipsis" title={transfer.fileName}>
          {transfer.fileName}
        </div>
        <div className="small muted download-detail">
          <span className="download-from">from {transfer.from}</span>
          {/* Titled as well as shown, because the whole of a long failure is
              worth being able to read even where it has been wrapped. */}
          <span className="download-status" title={describe(transfer)}>
            {describe(transfer)}
          </span>
        </div>
        {(running || offered) && <TransferBar transfer={transfer} />}
      </div>

      <div className="download-actions">
        {offered && (
          <button type="button" className="button" onClick={() => void store.acceptTransfer(transfer.id)}>
            Accept
          </button>
        )}
        {/* Only while there is something to stop. A finished row has nothing
            this button could do, and one that did nothing would still look
            like it might delete the file. */}
        {(running || offered) && (
          <IconButton
            name="close"
            title={offered ? 'Decline this file' : 'Cancel this transfer'}
            className="calling"
            onClick={() => void store.cancelTransfer(transfer.id)}
          />
        )}
      </div>
    </div>
  )
}

function markFor(t: DccTransfer): string {
  if (t.state === 'done') return 'check_circle'
  if (t.state === 'failed') return 'error'
  if (t.state === 'declined') return 'block'
  if (t.state === 'offered') return 'help'
  return looksExecutable(t.fileName) ? 'warning' : 'download'
}

/** The one line that says where this transfer got to. */
function describe(t: DccTransfer): string {
  switch (t.state) {
    case 'receiving': {
      const rate = humanRate(t.rate)
      const moved = `${humanSize(t.received)} of ${humanSize(t.size)}`
      return rate ? `${moved} · ${rate}` : moved
    }
    case 'offered':
      return `${humanSize(t.size)} · waiting for an answer`
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
