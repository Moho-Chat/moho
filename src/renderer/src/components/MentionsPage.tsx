import { useState } from 'react'
import { accountOfBuffer } from '../lib/route'
import { Icon } from './Icon'
import { Avatar } from './Avatar'
import { useChat, usePref, useStore } from '../state/hooks'
import { isMutedBuffer } from '../lib/groups'
import { bufferDisplayName, classes, dayLabel, dayOf, formatFullTime, serviceLabel } from '../lib/util'
import { IconButton } from './Icon'

/**
 * Everything that mentioned you, from every service, newest first - read and
 * unread alike, which is what separates it from the inbox in the header.
 *
 * The point of gathering these is that a mention worth answering is usually in
 * a channel nobody has open, so the list comes from the daemon rather than
 * from what this window happens to have loaded. It reads that list off the
 * store instead of asking again: the inbox needs the same rows to keep a live
 * count, and two copies fetched separately would disagree the moment one of
 * them was refreshed.
 *
 * What counts as a mention is decided where the message arrives, by the
 * backend that can actually tell: Discord answers it from its own resolved
 * mentions array, and IRC from the nickname, because that is all IRC has.
 */
export function MentionsPage(): JSX.Element {
  const store = useStore()
  const buffers = useChat((s) => s.buffers)
  const accounts = useChat((s) => s.accounts)
  const rows = useChat((s) => s.mentions)
  const [muted] = usePref<string[]>('mutedBuffers', [])
  const [mutedGroups] = usePref<string[]>('mutedGroups', [])
  const lastRead = useChat((s) => s.lastReadTs)
  // Put away one at a time, and remembered: the list is everything that ever
  // mentioned you, and is only worth reading while it holds what still needs
  // an answer.
  const [dismissed, setDismissed] = usePref<string[]>('mentions.dismissed', [])
  const [service, setService] = useState<string>('all')
  const [unreadOnly, setUnreadOnly] = useState(false)

  // A muted conversation was told not to ask for attention. Collecting its
  // mentions into a page whose entire purpose is asking for attention would
  // be the one place that instruction is ignored.
  const live = rows.filter((m) => {
    const buffer = buffers.find((b) => b.id === m.bufferId)
    return (!buffer || !isMutedBuffer(buffer, muted, mutedGroups)) && !dismissed.includes(m.id)
  })
  const serviceOf = (bufferId: string): string => {
    const buffer = buffers.find((b) => b.id === bufferId)
    return accounts.find((a) => a.id === buffer?.accountId)?.service ?? ''
  }
  const isUnread = (m: (typeof rows)[number]): boolean => m.ts > (lastRead[m.bufferId] ?? 0)
  const services = [...new Set(live.map((m) => serviceOf(m.bufferId)).filter(Boolean))]
  const mentions = live.filter(
    (m) => (service === 'all' || serviceOf(m.bufferId) === service) && (!unreadOnly || isUnread(m))
  )

  if (live.length === 0) {
    return (
      <div className="mentions-page empty muted">
        <Icon name="alternate_email" size={32} />
        <p>{rows.length === 0 ? 'Nothing has mentioned you yet.' : 'Nothing left to answer.'}</p>
        {dismissed.length > 0 && (
          <button type="button" className="button subtle small" onClick={() => setDismissed([])}>
            Bring back the ones put away
          </button>
        )}
      </div>
    )
  }

  // Grouped by the day they came, newest first, as the list already is.
  const groups: { day: number; label: string; items: typeof mentions }[] = []
  for (const m of mentions) {
    const day = dayOf(m.ts)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.items.push(m)
    else groups.push({ day, label: dayLabel(m.ts), items: [m] })
  }

  return (
    <div className="mentions-page">
      <div className="mentions-filters">
        {['all', ...services].map((value) => (
          <button
            key={value}
            type="button"
            className={classes('service-chip', service === value && 'active')}
            onClick={() => setService(value)}
          >
            {value === 'all' ? 'All' : serviceLabel(value as never)}
          </button>
        ))}
        <span className="mentions-filters-gap" />
        <button
          type="button"
          className={classes('service-chip', unreadOnly && 'active')}
          aria-pressed={unreadOnly}
          onClick={() => setUnreadOnly(!unreadOnly)}
        >
          Unread
        </button>
      </div>

      {mentions.length === 0 && <p className="muted small mentions-none">Nothing matches those filters.</p>}

      {groups.map((group) => (
        <div key={group.day}>
          <div className="date-divider" role="separator">
            <span>{group.label}</span>
          </div>
          {group.items.map((m) => {
            const buffer = buffers.find((b) => b.id === m.bufferId)
            const account = accounts.find((a) => a.id === buffer?.accountId)
            // A mention whose conversation this client has since forgotten still
            // shows: the message is the point, and refusing to draw it because the
            // buffer list has moved on would hide the very thing being collected.
            const where = buffer ? bufferDisplayName(buffer.name) : 'a closed conversation'
            return (
              <div key={m.id} className={classes('mention-entry', isUnread(m) && 'unread')}>
                <button
                  type="button"
                  className="mention-open"
                  // Opens the conversation and scrolls to the message itself, which
                  // is the only reason to click one of these.
                  onClick={() => {
                    if (!buffer) return
                    void store
                      .selectBuffer(buffer.id, true)
                      .then(() => store.jumpToMessage(buffer.id, m.id).then(() => store.setJumpTarget(m.id)))
                  }}
                  disabled={!buffer}
                >
                  <Avatar name={m.from} url={m.avatarUrl} size={32} accountId={accountOfBuffer(m.bufferId)} />
                  <span className="mention-body">
                    <span className="mention-head small">
                      <span className="mention-from">{m.from}</span>
                      <span className="muted">
                        in {where}
                        {account ? ` · ${serviceLabel(account.service)}` : ''}
                      </span>
                      <span className="muted mention-when" title={formatFullTime(m.ts)}>
                        {new Date(m.ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </span>
                    <span className="mention-text-two">{m.body}</span>
                  </span>
                </button>
                <IconButton
                  name="close"
                  size={14}
                  title="Put this away"
                  className="mention-dismiss"
                  onClick={() => setDismissed([...dismissed, m.id].slice(-500))}
                />
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
