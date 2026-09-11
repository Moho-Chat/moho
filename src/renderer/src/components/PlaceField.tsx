import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { HeaderPopover } from './HeaderPopover'

/**
 * Sending a place, as a field rather than as a map.
 *
 * Deliberately not a map picker. Drawing one means fetching tiles from
 * somebody's tile server, and the receive side already decided against that -
 * a message that mentions a street corner should not tell a third party it was
 * read. Sending should not quietly undo the decision receiving made.
 *
 * So it is a box, and the daemon does the hard part: it accepts a pasted map
 * link (OpenStreetMap, Google Maps, anything carrying the place in a query
 * parameter), a `geo:` URI, or two numbers with a comma between them. Which is
 * what people actually have to hand - nobody types coordinates from memory,
 * they copy a link.
 *
 * The label is the part a person reads. A pair of coordinates arriving with no
 * name is a pin in the middle of nowhere as far as the recipient is concerned,
 * so it is offered first and the coordinates second.
 */
export function PlaceField({
  anchor,
  onSend,
  onClose
}: {
  anchor: HTMLElement | null
  onSend: (place: string, label: string) => void
  onClose: () => void
}): JSX.Element {
  const [place, setPlace] = useState('')
  const [label, setLabel] = useState('')
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    field.current?.focus()
  }, [])

  const send = (): void => {
    const trimmed = place.trim()
    if (!trimmed) return
    onSend(trimmed, label.trim())
  }

  return (
    <HeaderPopover anchor={anchor} width={320} onClose={onClose}>
      <div className="place-form">
        <div className="small muted">
          Paste a map link, or type coordinates as <code>51.5, -0.12</code>.
        </div>

        <div className="popover-field">
          <Icon name="location_on" size={16} />
          <input
            ref={field}
            type="text"
            value={place}
            placeholder="Map link or coordinates"
            onChange={(e) => setPlace(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send()
              if (e.key === 'Escape') onClose()
            }}
          />
        </div>

        <div className="popover-field">
          <Icon name="label" size={16} />
          <input
            type="text"
            value={label}
            placeholder="What is there (optional)"
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send()
              if (e.key === 'Escape') onClose()
            }}
          />
        </div>

        <div className="place-actions">
          <button type="button" className="button primary" disabled={!place.trim()} onClick={send}>
            Send
          </button>
        </div>
      </div>
    </HeaderPopover>
  )
}
