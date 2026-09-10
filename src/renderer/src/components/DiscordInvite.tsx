import { useRef, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { HeaderPopover } from './HeaderPopover'
import { useChat, useStore } from '../state/hooks'
import type { BufferEntry } from '../state/store'

/**
 * How long an invite lasts, in seconds, and what to call each.
 *
 * Discord's own list, in Discord's own order, with Discord's own meaning for
 * zero: never expires. Offered rather than reduced to one default because the
 * choice is the whole reason somebody opens this - an invite to a private
 * server and one pasted in a public thread want opposite answers.
 */
const AGES: [number, string][] = [
  [1800, '30 minutes'],
  [3600, '1 hour'],
  [21600, '6 hours'],
  [43200, '12 hours'],
  [86400, '1 day'],
  [604800, '7 days'],
  [0, 'Never']
]

/** How many people may use it. Zero is Discord's "no limit". */
const USES: [number, string][] = [
  [0, 'No limit'],
  [1, '1 use'],
  [5, '5 uses'],
  [10, '10 uses'],
  [25, '25 uses'],
  [50, '50 uses'],
  [100, '100 uses']
]

/**
 * Making an invite to a Discord conversation.
 *
 * Accepting one has worked for a long time and making one did not, so
 * inviting anybody meant opening the official client to fetch a link. This is
 * that link.
 *
 * A form rather than a single button, because an invite is not one thing: the
 * three options Discord offers are the difference between a link posted in
 * public and one sent to a person, and picking for somebody would be picking
 * wrong half the time. They are asked here, next to the gesture, and the
 * defaults are Discord's own.
 *
 * The link is shown as well as copied. Copying silently is a gesture with no
 * evidence it happened, and an invite is a thing people want to read before
 * they send it - who it is for is written into it.
 */
export function DiscordInvite({ buffer }: { buffer: BufferEntry }): JSX.Element | null {
  const store = useStore()
  const roster = useChat((s) => s.presenceByBuffer[buffer.id])
  const [open, setOpen] = useState(false)
  const [age, setAge] = useState(86400)
  const [uses, setUses] = useState(0)
  const [temporary, setTemporary] = useState(false)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const button = useRef<HTMLSpanElement>(null)

  // A one-to-one is the one Discord conversation with no link into it: an
  // invite would have to add a third person, and Discord answers that by
  // making a new group instead - which is what the button beside this one
  // does. A group message takes an invite the same way a channel does, and
  // both arrive here as `kind: 'dm'`, so the roster is what tells them apart.
  if (buffer.kind === 'dm' && (roster?.length ?? 0) <= 1) return null

  const make = (): void => {
    setBusy(true)
    void window.moho
      .rpc<{ invite: string }>('createDiscordInvite', {
        bufferId: buffer.id,
        maxAge: age,
        maxUses: uses,
        temporary
      })
      .then((r) => {
        setLink(r.invite)
        // Copied as it is made, because that is what it is for. It stays on
        // screen too - see above.
        return window.moho.copyText(r.invite).then(() => store.toast('info', 'Invite copied'))
      })
      .catch((e: Error) => store.toast('error', e.message))
      .finally(() => setBusy(false))
  }

  const shut = (): void => {
    setOpen(false)
    // A link belongs to the options it was made with; leaving the last one
    // sitting there would offer to copy an invite the next set of choices
    // has nothing to do with.
    setLink('')
  }

  return (
    <>
      <span ref={button} className="header-anchor">
        <IconButton
          name="add_link"
          title="Make an invite to this conversation"
          onClick={() => (open ? shut() : setOpen(true))}
        />
      </span>
      {open && (
        <HeaderPopover anchor={button.current} width={320} onClose={shut}>
          <div className="invite-form">
            <label className="invite-row small">
              <span className="muted">Expires after</span>
              <select value={age} disabled={busy} onChange={(e) => setAge(Number(e.target.value))}>
                {AGES.map(([seconds, label]) => (
                  <option key={seconds} value={seconds}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="invite-row small">
              <span className="muted">Number of uses</span>
              <select value={uses} disabled={busy} onChange={(e) => setUses(Number(e.target.value))}>
                {USES.map(([count, label]) => (
                  <option key={count} value={count}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            {/* Discord's own wording for it is "temporary membership", which
                says nothing on its own - what it actually does is worth a
                sentence, since it is the one option with a consequence
                somebody would not expect. */}
            <label className="invite-check small">
              <input
                type="checkbox"
                checked={temporary}
                disabled={busy}
                onChange={(e) => setTemporary(e.target.checked)}
              />
              <span>Remove them again when they go offline, unless given a role</span>
            </label>

            <div className="invite-actions">
              <button type="button" className="button primary" disabled={busy} onClick={make}>
                {link ? 'Make another' : 'Make invite'}
              </button>
            </div>

            {link && (
              <div className="popover-field invite-link">
                <Icon name="link" size={16} />
                <input readOnly value={link} onFocus={(e) => e.target.select()} />
                <IconButton
                  name="content_copy"
                  size={16}
                  title="Copy it again"
                  onClick={() => void window.moho.copyText(link).then(() => store.toast('info', 'Invite copied'))}
                />
              </div>
            )}
          </div>
        </HeaderPopover>
      )}
    </>
  )
}
