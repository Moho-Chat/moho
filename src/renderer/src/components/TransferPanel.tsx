import { Icon, IconButton } from './Icon'
import { useChat, useStore } from '../state/hooks'
import type { DccTransfer } from '../../../shared/wire'

/**
 * Files offered over IRC: the asking, and then the watching.
 *
 * Floats over everything for the same reason the call panel does - an offer
 * arrives while you are looking somewhere else, often in a conversation you
 * are not reading, and a prompt buried in a channel you have scrolled away
 * from is a prompt nobody answers.
 *
 * It asks first. Somebody you have never spoken to can send an offer, and
 * accepting one puts their file on your disk; that is worth a sentence and a
 * button rather than a surprise in your downloads folder. What it shows is
 * chosen for the decision being made: who it is from, what it will be called,
 * and how big - the three things that make an offer obviously wrong.
 */
export function TransferPanel(): JSX.Element | null {
  const store = useStore()
  const transfers = useChat((s) => s.transfers)

  // Finished ones are history rather than something to answer, and belong in
  // the list this panel is not - they leave once they are done.
  const showing = transfers.filter((t) => t.state === 'offered' || t.state === 'receiving')
  if (showing.length === 0) return null

  return (
    <div className="transfer-panel">
      {showing.map((t) => (
        <div key={t.id} className="transfer-card">
          {t.state === 'offered' ? (
            <Offer transfer={t} onAccept={() => void store.acceptTransfer(t.id)} onDecline={() => void store.cancelTransfer(t.id)} />
          ) : (
            <Running transfer={t} onCancel={() => void store.cancelTransfer(t.id)} />
          )}
        </div>
      ))}
    </div>
  )
}

function Offer({
  transfer,
  onAccept,
  onDecline
}: {
  transfer: DccTransfer
  onAccept: () => void
  onDecline: () => void
}): JSX.Element {
  const risky = looksExecutable(transfer.fileName)
  return (
    <>
      <div className="transfer-head">
        <Icon name="save" size={18} />
        <span className="ellipsis">
          <b>{transfer.from}</b> is offering you a file
        </span>
      </div>

      <FileLine transfer={transfer} />

      {/* Not a block on anything - it is their disk and their decision - but
          the one property of a file that changes what accepting it means. */}
      {risky && (
        <p className="transfer-warning small">
          <Icon name="warning" size={14} />
          <span>This is a program. Opening it would run whatever they sent.</span>
        </p>
      )}

      <div className="transfer-actions">
        {/* Declining is the default focus: the safe answer should be the one
            a stray keypress gives. */}
        <button type="button" className="button" onClick={onDecline} autoFocus>
          Decline
        </button>
        <button type="button" className="button primary" onClick={onAccept}>
          Accept
        </button>
      </div>
    </>
  )
}

function Running({ transfer, onCancel }: { transfer: DccTransfer; onCancel: () => void }): JSX.Element {
  const pct = transfer.size > 0 ? Math.min(100, (transfer.received / transfer.size) * 100) : 0
  return (
    <>
      <div className="transfer-head">
        <Icon name="download" size={18} />
        <span className="ellipsis">
          Receiving from <b>{transfer.from}</b>
        </span>
        <IconButton name="close" title="Stop this transfer" onClick={onCancel} />
      </div>

      <FileLine transfer={transfer} />

      <div className="transfer-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="transfer-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="small muted">
        {humanSize(transfer.received)} of {humanSize(transfer.size)}
      </p>
    </>
  )
}

function FileLine({ transfer }: { transfer: DccTransfer }): JSX.Element {
  return (
    <div className="transfer-file">
      <span className="ellipsis" title={transfer.fileName}>
        {transfer.fileName}
      </span>
      <span className="small muted">{humanSize(transfer.size)}</span>
      {/* Shown only where the name had to be changed, so a file arriving
          under a different name than was offered is never a silent
          substitution - that difference is usually the interesting part. */}
      {transfer.rawName !== transfer.fileName && (
        <span className="small muted ellipsis" title={transfer.rawName}>
          they called it “{transfer.rawName}”
        </span>
      )}
    </div>
  )
}

/**
 * Whether opening this would run it rather than show it.
 *
 * Extension-based, which is exactly as reliable as the extension - the point
 * is to catch the ordinary case where somebody is handed a .exe they were not
 * expecting, not to be a verdict on the file.
 */
export function looksExecutable(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return [
    'exe', 'scr', 'com', 'pif', 'bat', 'cmd', 'msi', 'msp', 'jar', 'app',
    'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'lnk',
    'dll', 'sys', 'sh', 'run', 'deb', 'rpm', 'apk', 'dmg', 'pkg'
  ].includes(ext)
}

export function humanSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return unit === 0 ? `${bytes} B` : `${size.toFixed(1)} ${units[unit]}`
}
