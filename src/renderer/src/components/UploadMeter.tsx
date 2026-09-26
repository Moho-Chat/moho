import { useEffect, useState } from 'react'

/**
 * What a message's attachment is doing, while it is doing it.
 *
 * An upload to somebody else's host is the one part of sending that can take
 * a minute and has nothing to show for itself. Without this the row sat there
 * looking exactly like a message that had gone nowhere, and after ten seconds
 * the send timeout called it failed - so the only feedback anybody got was
 * wrong.
 *
 * A ring rather than a bar, and no percentage: the file is handed to the HTTP
 * client whole, so there is no byte count to honestly draw. What can be said
 * is which wait this is and how long it has been, and that is what this says.
 */
export function UploadMeter({
  phase,
  bytes,
  host,
  since
}: {
  phase: 'preparing' | 'sending' | 'waiting'
  bytes: number
  host: string
  since: number
}): JSX.Element {
  // Ticks so the elapsed time moves. A second is the right grain: this is
  // there to show the thing is alive, not to be read off.
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  const where = host || 'the image host'
  const said =
    phase === 'preparing'
      ? 'Preparing the file…'
      : phase === 'sending'
        ? `Uploading${bytes ? ` ${formatSize(bytes)}` : ''} to ${where}…`
        : `Waiting for ${where}…`

  return (
    <span className="upload-meter small" role="status">
      <svg className="upload-ring" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle className="upload-ring-track" cx="8" cy="8" r="6" fill="none" />
        <circle className="upload-ring-arc" cx="8" cy="8" r="6" fill="none" />
      </svg>
      <span>{said}</span>
      {seconds >= 3 && <span className="upload-elapsed">{seconds}s</span>}
    </span>
  )
}

/** Sizes the way a person says them, not the way a disk does. */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}
