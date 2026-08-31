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
  const minimised = useChat((s) => s.minimisedTransfers)

  // Finished ones are history rather than something to answer, and belong
  // under Downloads instead - they leave here once they are done. So does
  // anything put away, which is still running and still listed there.
  const showing = transfers.filter(
    (t) => t.state !== 'done' && t.state !== 'declined' && t.state !== 'failed' && !minimised.includes(t.id)
  )
  if (showing.length === 0) return null

  return (
    <div className="transfer-panel">
      {showing.map((t) => (
        <div key={t.id} className="transfer-card">
          {/* An offer we made is not a question for us to answer - it is
              waiting on them - so it shows as a transfer rather than as a
              prompt with buttons that would do nothing. */}
          {t.state === 'offered' && !t.outgoing ? (
            <Offer transfer={t} onAccept={() => void store.acceptTransfer(t.id)} onDecline={() => void store.cancelTransfer(t.id)} />
          ) : (
            <Running
              transfer={t}
              onCancel={() => void store.cancelTransfer(t.id)}
              onMinimise={() => store.minimiseTransfer(t.id)}
            />
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

function Running({
  transfer,
  onCancel,
  onMinimise
}: {
  transfer: DccTransfer
  onCancel: () => void
  onMinimise: () => void
}): JSX.Element {
  return (
    <>
      <div className="transfer-head">
        <Icon name={transfer.outgoing ? 'upload' : 'download'} size={18} />
        <span className="ellipsis">
          {transfer.outgoing ? (
            transfer.state === 'offered' ? (
              <>
                Waiting for <b>{transfer.from}</b> to accept
              </>
            ) : (
              <>
                Sending to <b>{transfer.from}</b>
              </>
            )
          ) : (
            <>
              Receiving from <b>{transfer.from}</b>
            </>
          )}
        </span>
        {/* Two buttons rather than one, because they are opposite actions and
            a single X would have to mean one of them. Putting it away is the
            harmless one, so it sits first and away from the corner a window's
            close button trains people to aim at. */}
        <IconButton name="expand_more" title="Hide this - it keeps going, under Downloads" onClick={onMinimise} />
        <IconButton
          name="close"
          title={transfer.outgoing && transfer.state === 'offered' ? 'Withdraw this offer' : 'Cancel this transfer'}
          className="calling"
          onClick={onCancel}
        />
      </div>

      <FileLine transfer={transfer} />
      {/* Nothing has moved yet while an offer is out, so a bar sitting at zero
          would only look like a stall. */}
      {transfer.state !== 'offered' && (
        <>
          <TransferBar transfer={transfer} />
          <p className="small muted transfer-stats">
            <span>
              {humanSize(transfer.received)} of {humanSize(transfer.size)}
            </span>
            <span>{humanRate(transfer.rate)}</span>
          </p>
        </>
      )}
    </>
  )
}

export function TransferBar({ transfer }: { transfer: DccTransfer }): JSX.Element {
  const pct = transfer.size > 0 ? Math.min(100, (transfer.received / transfer.size) * 100) : 0
  return (
    <div
      className="transfer-bar"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="transfer-bar-fill" style={{ width: `${pct}%` }} />
    </div>
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

/**
 * A speed, in whichever unit makes it a small number.
 *
 * Nothing rather than "0 KB/s" when a transfer is not moving: a rate of zero
 * is either a stall or the moment before the first measurement, and neither is
 * worth a line of its own where the bar above already says nothing changed.
 */
export function humanRate(bytesPerSecond: number): string {
  if (!bytesPerSecond) return ''
  return `${humanSize(bytesPerSecond)}/s`
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
