import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, IconButton } from './Icon'
import { useStore } from '../state/hooks'

/** What the daemon read back off the server. */
interface Source {
  eventId: string
  roomId: string
  event: unknown
  /** Present only where there was something to decrypt. */
  decrypted?: unknown
}

/**
 * The event behind a message, as the server holds it.
 *
 * What somebody reaches for when a message is wrong: a body that rendered
 * oddly, a reply pointing at nothing, a state change nobody made. Everything
 * else in this window shows what the client *made* of an event, and the whole
 * reason to look at the source is that what it made may be wrong - so this is
 * fetched from the server rather than taken from the timeline.
 *
 * Two halves in an encrypted room, which is what Element shows and what is
 * actually useful: the envelope is what was sent and what any other client
 * sees, and the plaintext is what it turned out to say. A room with nothing
 * to decrypt shows one, because the same JSON twice teaches nobody anything.
 */
export function EventSource({
  bufferId,
  messageId,
  onClose
}: {
  bufferId: string
  messageId: string
  onClose: () => void
}): JSX.Element {
  const store = useStore()
  const [source, setSource] = useState<Source | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    void window.moho
      .rpc<Source>('matrixEventSource', { bufferId, messageId })
      .then(setSource)
      .catch((e: Error) => setFailed(e.message))
  }, [bufferId, messageId])

  // Escape closes it, the same as every other dialog here. A panel of JSON is
  // exactly the thing somebody opens by accident and wants gone.
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const copy = (value: unknown): void => {
    void window.moho.copyText(JSON.stringify(value, null, 2))
    store.toast('info', 'Copied')
  }

  return createPortal(
    <div className="lightbox-backdrop" onClick={onClose}>
      <div className="event-source" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="reason-prompt-head">
          <Icon name="data_object" size={18} />
          <span>Message source</span>
        </div>
        <div className="small muted ellipsis">{messageId}</div>

        {!source && !failed && <div className="small muted">Reading…</div>}
        {failed && <div className="small muted">Couldn’t read it: {failed}</div>}

        {source && (
          <>
            {/* The plaintext first where there is one: it is the half that
                answers the question, and the envelope below it is the
                supporting evidence. */}
            {source.decrypted !== undefined && source.decrypted !== null && (
              <Block label="Decrypted" value={source.decrypted} onCopy={copy} />
            )}
            <Block
              label={source.decrypted ? 'As sent (encrypted)' : 'As sent'}
              value={source.event}
              onCopy={copy}
            />
          </>
        )}

        <div className="reason-prompt-actions">
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function Block({
  label,
  value,
  onCopy
}: {
  label: string
  value: unknown
  onCopy: (value: unknown) => void
}): JSX.Element {
  return (
    <div className="event-source-block">
      <div className="event-source-label">
        <span className="small muted">{label}</span>
        <IconButton name="content_copy" size={16} title="Copy this" onClick={() => onCopy(value)} />
      </div>
      {/* Scrolls in its own box rather than stretching the dialog. An event
          from a bridge can be hundreds of lines, and a dialog as tall as the
          conversation behind it has no close button on screen. */}
      <pre className="event-source-json">{JSON.stringify(value, null, 2)}</pre>
    </div>
  )
}
