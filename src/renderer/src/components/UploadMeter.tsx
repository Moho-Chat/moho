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
 * A ring that fills where the upload counts its bytes (Discord's does: the
 * files are streamed), and one that turns where it cannot - most hosts take
 * the file whole, so a percentage there would be invented. Either way it says
 * which wait this is and how long it has been.
 */
export function UploadMeter({
  phase,
  bytes,
  host,
  since,
  sent,
  total,
  files
}: {
  phase: 'preparing' | 'sending' | 'waiting'
  bytes: number
  host: string
  since: number
  sent?: number
  total?: number
  files?: number
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
  const noun = files && files > 1 ? `${files} files` : ''
  // Counted: how far through, in the one unit people read at a glance.
  const counted = phase === 'sending' && !!total && sent !== undefined
  const fraction = counted ? Math.min(1, Math.max(0, sent! / total!)) : 0
  const said =
    phase === 'preparing'
      ? `Preparing the ${noun || 'file'}…`
      : phase === 'sending'
        ? counted
          ? `Uploading${noun ? ` ${noun}` : ''} to ${where} - ${Math.floor(fraction * 100)}% (${formatSize(sent!)} of ${formatSize(total!)})`
          : `Uploading${noun ? ` ${noun}` : bytes ? ` ${formatSize(bytes)}` : ''} to ${where}…`
        : `Waiting for ${where}…`
  const CIRCUMFERENCE = 2 * Math.PI * 6

  return (
    <span className="upload-meter small" role="status">
      <svg className="upload-ring" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle className="upload-ring-track" cx="8" cy="8" r="6" fill="none" />
        <circle
          className={`upload-ring-arc${counted ? ' counted' : ''}`}
          cx="8"
          cy="8"
          r="6"
          fill="none"
          // A style, not an attribute: the stylesheet's own dash pattern for the
          // turning ring would win over an attribute.
          style={counted ? { strokeDasharray: `${fraction * CIRCUMFERENCE} ${CIRCUMFERENCE}` } : undefined}
        />
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
