import { useMemo, useState } from 'react'
import { accountOfBuffer } from '../lib/route'
import { Icon, IconButton, ServiceMark } from './Icon'
import { Avatar } from './Avatar'
import { useChat, usePref, useStore } from '../state/hooks'
import { isMutedBuffer } from '../lib/groups'
import { isUnreadMention, withRead } from '../lib/mentioninbox'
import { bufferDisplayName, classes, dayLabel, dayOf, formatFullTime, formatTime, resolveMediaUrl, serviceIcon, serviceLabel } from '../lib/util'
import type { Message } from '../../../shared/wire'

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
 *
 * Laid out as the other panes are (#339): the places that mentioned you down
 * the left with how many are waiting in each, and the mentions of the one
 * chosen on the right. The channel list has nothing to say here, so the page
 * has its column.
 */
export function MentionsPage(): JSX.Element {
  const store = useStore()
  const buffers = useChat((s) => s.buffers)
  const accounts = useChat((s) => s.accounts)
  const groups = useChat((s) => s.groups)
  const rows = useChat((s) => s.mentions)
  const [muted] = usePref<string[]>('mutedBuffers', [])
  const [mutedGroups] = usePref<string[]>('mutedGroups', [])
  const lastRead = useChat((s) => s.lastReadTs)
  // Put away one at a time, and remembered: the list is everything that ever
  // mentioned you, and is only worth reading while it holds what still needs
  // an answer.
  const [dismissed, setDismissed] = usePref<string[]>('mentions.dismissed', [])
  const [emptiedTs, setEmptiedTs] = usePref<number>('mentionsDismissedTs', 0)
  const [read, setRead] = usePref<string[]>('mentions.read', [])
  const [place, setPlace] = useState<string>('all')
  const [unreadOnly, setUnreadOnly] = usePref<boolean>('mentions.unreadOnly', false)
  const marks = useMemo(() => ({ lastRead, emptiedTs, read }), [lastRead, emptiedTs, read])

  // A muted conversation was told not to ask for attention. Collecting its
  // mentions into a page whose entire purpose is asking for attention would
  // be the one place that instruction is ignored.
  const live = rows.filter((m) => {
    const buffer = buffers.find((b) => b.id === m.bufferId)
    return (!buffer || !isMutedBuffer(buffer, muted, mutedGroups)) && !dismissed.includes(m.id)
  })
  /** Where a mention came from: its server, or its account where it is in no server. */
  const placeOf = (m: Message): string => {
    const buffer = buffers.find((b) => b.id === m.bufferId)
    return buffer?.groupId || (buffer ? `account:${buffer.accountId}` : 'gone')
  }
  const isUnread = (m: Message): boolean => isUnreadMention(m, marks)
  const places = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; service: string; iconUrl?: string; total: number; unread: number }>()
    for (const m of live) {
      const id = placeOf(m)
      const group = groups.find((g) => g.id === id)
      const account = accounts.find((a) => a.id === buffers.find((b) => b.id === m.bufferId)?.accountId)
      const entry =
        seen.get(id) ??
        ({
          id,
          name: id === 'gone' ? 'Closed conversations' : group && group.kind !== 'account' && group.kind !== 'dms' ? group.name : account ? `${account.displayName || account.id}` : 'Unknown',
          service: group?.service ?? account?.service ?? '',
          iconUrl: group?.iconUrl,
          total: 0,
          unread: 0
        } as const)
      seen.set(id, { ...entry, total: entry.total + 1, unread: entry.unread + (isUnread(m) ? 1 : 0) })
    }
    return [...seen.values()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.length, marks, groups, accounts, buffers])
  const media = resolveMediaUrl

  const inPlace = live.filter((m) => place === 'all' || placeOf(m) === place)
  const mentions = inPlace.filter((m) => !unreadOnly || isUnread(m))
  const waiting = live.filter(isUnread).length

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
  const days: { day: number; label: string; items: typeof mentions }[] = []
  for (const m of mentions) {
    const day = dayOf(m.ts)
    const last = days[days.length - 1]
    if (last && last.day === day) last.items.push(m)
    else days.push({ day, label: dayLabel(m.ts), items: [m] })
  }

  const open = (m: Message): void => {
    const buffer = buffers.find((b) => b.id === m.bufferId)
    if (!buffer) return
    void store.selectBuffer(buffer.id, true).then(() => store.jumpToMessage(buffer.id, m.id).then(() => store.setJumpTarget(m.id)))
  }

  return (
    <div className="mentions-page">
      <nav className="mentions-places" aria-label="Where from">
        <button type="button" className={classes('side-tabs-item', place === 'all' && 'active')} onClick={() => setPlace('all')}>
          <Icon name="all_inbox" size={18} />
          <span className="ellipsis mentions-place-name">Everywhere</span>
          {waiting > 0 && <span className="mentions-place-count">{waiting}</span>}
        </button>
        <div className="side-tabs-heading">From</div>
        {places.map((p) => (
          <button
            key={p.id}
            type="button"
            className={classes('side-tabs-item', place === p.id && 'active')}
            title={`${p.name}${p.service ? ` · ${serviceLabel(p.service as never)}` : ''}: ${p.total} mention${p.total === 1 ? '' : 's'}`}
            onClick={() => setPlace(p.id)}
          >
            {p.iconUrl ? (
              <img className="mentions-place-icon" src={media(p.iconUrl)} alt="" />
            ) : (
              <span className="mentions-place-icon mark">
                <ServiceMark icon={serviceIcon(p.service as never)} size={12} />
              </span>
            )}
            <span className="ellipsis mentions-place-name">{p.name}</span>
            {p.unread > 0 && <span className="mentions-place-count">{p.unread}</span>}
          </button>
        ))}
      </nav>

      <div className="mentions-list">
        <div className="mentions-head">
          <div className="segmented" role="group" aria-label="Which mentions">
            <button type="button" className={unreadOnly ? 'active' : undefined} aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>
              Unread{inPlace.filter(isUnread).length > 0 ? ` · ${inPlace.filter(isUnread).length}` : ''}
            </button>
            <button type="button" className={unreadOnly ? undefined : 'active'} aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>
              All · {inPlace.length}
            </button>
          </div>
          <span className="mentions-filters-gap" />
          <button type="button" className="button" disabled={waiting === 0} onClick={() => setEmptiedTs(Math.floor(Date.now() / 1000))}>
            <Icon name="done_all" size={16} /> Mark all read
          </button>
        </div>

        <div className="mentions-rows">
          {mentions.length === 0 && (
            <p className="muted small mentions-none">{unreadOnly ? 'Nothing is waiting here.' : 'Nothing from here.'}</p>
          )}

          {days.map((group) => (
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
                const unread = isUnread(m)
                const picture = m.attachments?.find((a) => a.kind === 'image' && (a.thumbnailPath || a.path))
                return (
                  <div key={m.id} className={classes('mention-entry', unread ? 'unread' : 'read')}>
                    <button
                      type="button"
                      className="mention-open"
                      // Opens the conversation and scrolls to the message itself, which
                      // is the only reason to click one of these.
                      onClick={() => open(m)}
                      disabled={!buffer}
                    >
                      <Avatar name={m.from} url={m.avatarUrl} size={32} accountId={accountOfBuffer(m.bufferId)} />
                      <span className="mention-body">
                        <span className="mention-head small">
                          <span className="mention-from">{m.from}</span>
                          <span className="muted ellipsis">
                            in {where}
                            {account ? ` · ${serviceLabel(account.service)}` : ''}
                          </span>
                          <span className="muted mention-when" title={formatFullTime(m.ts)}>
                            {formatTime(m.ts)}
                          </span>
                        </span>
                        {/* What it was said in answer to, where it was an answer: half of what a mention means. */}
                        {m.replyTo && (m.replyTo.from || m.replyTo.body) && (
                          <span className="mention-reply small muted ellipsis">
                            <Icon name="reply" size={13} />
                            {m.replyTo.from && <span className="mention-reply-from">{m.replyTo.from}</span>} {m.replyTo.body}
                          </span>
                        )}
                        <span className="mention-text-two">{m.body}</span>
                      </span>
                      {picture && <img className="mention-thumb" src={media(picture.thumbnailPath || picture.path || '')} alt="" />}
                    </button>
                    <span className="mention-actions">
                      {unread && (
                        <IconButton name="done" size={16} title="Mark this one read" onClick={() => setRead(withRead(read, m.id))} />
                      )}
                      <IconButton
                        name="close"
                        size={16}
                        title="Put this away: take it off the list"
                        onClick={() => setDismissed([...dismissed, m.id].slice(-500))}
                      />
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
