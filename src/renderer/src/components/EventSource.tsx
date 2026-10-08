import { useEffect, useState } from 'react'
import { IconButton } from './Icon'
import { Modal } from './Modal'
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

  const copy = (value: unknown): void => {
    void window.moho.copyText(JSON.stringify(value, null, 2))
    store.toast('info', 'Copied')
  }

  // Escape closes it, the same as every other dialog here: a panel of JSON is
  // exactly the thing somebody opens by accident and wants gone.
  return (
    <Modal title="Message source" icon="data_object" className="event-source" onClose={onClose}>
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
    </Modal>
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
