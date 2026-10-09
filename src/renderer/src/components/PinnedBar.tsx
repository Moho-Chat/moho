import { useEffect, useMemo, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { useChat, usePref, useStore } from '../state/hooks'
import { formatMessage, normalizeBBCode } from '../lib/format'
import { RichText } from '../lib/richtext'

/**
 * How many dismissed pins to remember before forgetting the oldest.
 *
 * A channel replaces its pin whenever the subject changes, and every one put
 * away leaves an id behind. Without a ceiling this is a list that only grows
 * and is written to disk each time. A hundred is far past any pin still on
 * screen anywhere - the oldest to go is one from a stream that ended weeks
 * ago.
 */
const REMEMBERED_DISMISSALS = 100

/**
 * The message a channel has pinned, above the log.
 *
 * Kick pins one line and leaves it there - the link, the rules, the thing
 * being talked about - and it is the one line a channel has deliberately put
 * in front of everybody. It sits where the live poll and prediction cards sit,
 * for the same reason: something that stays put while the chat moves
 * underneath it belongs out of the scroll.
 *
 * Dismissing it is remembered. A pin stays up for hours, so a bar that came
 * back on every restart would be a bar somebody dismisses every day - and one
 * dismissed in this window should be dismissed in a popped-out one too, which
 * is what a preference gets and this window's own state does not.
 *
 * Keyed on the pinned message's id rather than on the channel, so putting this
 * one away does not put away the next one - and the next one is the whole
 * reason a channel pins anything.
 */
export function PinnedBar({ bufferId }: { bufferId: string }): JSX.Element | null {
  const pin = useChat((s) => s.pinnedByBuffer)[bufferId]
  // Kick pins one line and sends it unasked; Discord and Matrix pin many and
  // are asked. The same place for both, since it is the same thing.
  if (!pin) return <PinnedMessagesBanner bufferId={bufferId} />
  return <PinnedLine bufferId={bufferId} pin={pin} />
}

function PinnedLine({ pin }: { bufferId: string; pin: { id: string; from: string; body: string } }): JSX.Element | null {
  const [dismissed, setDismissed] = usePref<string[]>('kick.pinDismissed', [])
  // Through the same pipeline every other body goes through, so a link in a
  // pin is a link and an emote is an emote - a pin is very often exactly a
  // link, which is most of why a channel pins one.
  const html = useMemo(() => formatMessage(normalizeBBCode(pin.body || '')), [pin.body])

  if (dismissed.includes(pin.id)) return null

  const dismiss = (): void =>
    setDismissed([...dismissed.filter((id) => id !== pin.id), pin.id].slice(-REMEMBERED_DISMISSALS))

  return (
    <div className="pinned-bar">
      <Icon name="push_pin" size={14} className="pinned-mark" />
      <div className="pinned-body">
        <span className="small muted">Pinned by {pin.from}</span>
        {/* `ownMarkup` because this client built the markup a line above,
            out of what Kick sent as plain text - the flag is about who wrote
            the HTML, not about who wrote the message. */}
        <RichText html={html} ownMarkup />
      </div>
      <IconButton name="close" size={14} title="Dismiss this pin" onClick={dismiss} />
    </div>
  )
}

/** Conversations whose pins have been asked for this session, so a failed ask is not repeated on every switch. */
const asked = new Set<string>()
/** Banners put away this session, by conversation: the pins are still in the header. */
const putAway = new Set<string>()

/**
 * What a Discord channel or a Matrix room has pinned, over the log: the
 * newest, with how many there are, and a click that goes to it.
 *
 * Element has this banner and Discord has only the header's list; the list is
 * kept (it is where a pin is taken off) and this is what makes a pin something
 * that is seen rather than something somebody knows to look for. Clicking goes
 * to the message and moves on to the next pin, so a run of pins is read by
 * clicking through it.
 */
function PinnedMessagesBanner({ bufferId }: { bufferId: string }): JSX.Element | null {
  const store = useStore()
  const account = useChat((s) => s.buffers).find((b) => b.id === bufferId)?.accountId ?? ''
  const rows = useChat((s) => s.pinnedRows)[bufferId]
  const [at, setAt] = useState(0)
  const [, redraw] = useState(0)
  const hasPins = account.startsWith('discord:') || account.startsWith('matrix:')

  useEffect(() => {
    setAt(0)
    if (!hasPins || rows || asked.has(bufferId)) return
    asked.add(bufferId)
    void store.loadPins(bufferId).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bufferId, hasPins])

  if (!hasPins || !rows || rows.length === 0 || putAway.has(bufferId)) return null
  const shown = rows[Math.min(at, rows.length - 1)]
  const first = (shown.body || '').split('\n')[0].trim() || 'A message with no text'

  return (
    <div className="pinned-bar pinned-banner">
      <Icon name="push_pin" size={14} className="pinned-mark" />
      <button
        type="button"
        className="pinned-banner-body"
        title="Go to the pinned message"
        onClick={() => {
          void store.jumpToMessage(bufferId, shown.id).then((there) => {
            if (there) store.setJumpTarget(shown.id)
            else store.toast('info', 'That message could not be reached')
          })
          if (rows.length > 1) setAt((at + 1) % rows.length)
        }}
      >
        <span className="small muted">
          {rows.length > 1 ? `Pinned · ${Math.min(at, rows.length - 1) + 1} of ${rows.length}` : 'Pinned'} · {shown.from}
        </span>
        <span className="ellipsis">{first}</span>
      </button>
      <IconButton
        name="close"
        size={14}
        title="Hide this banner (the pins stay in the header)"
        onClick={() => {
          putAway.add(bufferId)
          redraw((n) => n + 1)
        }}
      />
    </div>
  )
}
