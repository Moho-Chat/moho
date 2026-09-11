import { useMemo } from 'react'
import { Icon, IconButton } from './Icon'
import { useChat, usePref } from '../state/hooks'
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
  const [dismissed, setDismissed] = usePref<string[]>('kick.pinDismissed', [])
  // Through the same pipeline every other body goes through, so a link in a
  // pin is a link and an emote is an emote - a pin is very often exactly a
  // link, which is most of why a channel pins one.
  const html = useMemo(() => formatMessage(normalizeBBCode(pin?.body || '')), [pin?.body])

  if (!pin || dismissed.includes(pin.id)) return null

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
