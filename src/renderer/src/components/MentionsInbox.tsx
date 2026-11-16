import { accountOfBuffer } from '../lib/route'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, IconButton } from './Icon'
import { HeaderPopover } from './HeaderPopover'
import { Avatar } from './Avatar'
import { useChat, usePref, useStore } from '../state/hooks'
import { isMutedBuffer, MENTIONS_GROUP_ID } from '../lib/groups'
import { bufferDisplayName, classes, formatFullTime, formatRelativeTime, serviceLabel } from '../lib/util'
import { byPlace, isUnreadMention, withRead } from '../lib/mentioninbox'
import { useEscapeLayer } from '../lib/layers'

/**
 * The inbox: everything that mentioned you and that you have not seen yet.
 *
 * In the header rather than the rail because a mention is not a place. It is
 * a notice about somewhere you already have, and the thing you do with it is
 * glance, decide, and either go there or dismiss it - which is a popdown, the
 * same shape as the search beside it, and not a page you navigate to and then
 * have to navigate back out of.
 *
 * Unread only, deliberately. A list of every mention ever is a log; what makes
 * an inbox worth opening is that its contents are the things still owed an
 * answer, and that emptying it is possible.
 */
export function MentionsInbox(): JSX.Element {
  const store = useStore()
  const mentions = useChat((s) => s.mentions)
  const newRelease = useChat((s) => s.newRelease)
  // Dismissed by version: the next release is news again.
  const [dismissedRelease, setDismissedRelease] = usePref<string>('updates.dismissed', '')
  // Switched off in Settings: gone at once, not at the next check.
  const [notify] = usePref<boolean>('updates.notify', true)
  const release = notify && newRelease && newRelease.version !== dismissedRelease ? newRelease : null
  const buffers = useChat((s) => s.buffers)
  const accounts = useChat((s) => s.accounts)
  const [muted] = usePref<string[]>('mutedBuffers', [])
  const [mutedGroups] = usePref<string[]>('mutedGroups', [])
  // From the store rather than the preference hook: the store writes this one
  // straight through to main, so the renderer's preference cache never hears
  // about it and a mention would stay unread after its channel was read.
  const lastReadTs = useChat((s) => s.lastReadTs)
  /**
   * When the inbox was last emptied.
   *
   * A watermark of its own rather than marking each conversation read, which
   * is what "mark all as read" would otherwise have to mean. Those are two
   * different statements: dismissing a mention says you have seen the notice,
   * not that you have read the several hundred messages in the busy channel it
   * came from - and conflating them would quietly clear unread badges the
   * user never touched.
   */
  const [dismissedTs, setDismissedTs] = usePref<number>('mentionsDismissedTs', 0)
  const [read, setRead] = usePref<string[]>('mentions.read', [])
  const groups = useChat((s) => s.groups)
  const [open, setOpen] = useState(false)
  /** Which row the arrow keys are on. */
  const [at, setAt] = useState(0)
  /** Loading backwards towards a mention, which can take a moment. */
  const [jumping, setJumping] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const unread = useMemo(
    () =>
      mentions.filter((m) => {
        // Emptied from the inbox, ticked off, or the conversation itself has
        // been read since - opening the channel is the other, more natural
        // way to answer a mention, and it should not still be waiting
        // afterwards. The page counts the same ones: see lib/mentions.ts.
        if (!isUnreadMention(m, { lastRead: lastReadTs, emptiedTs: dismissedTs, read })) return false
        // A muted conversation was told not to ask for attention. Badging a
        // button on its behalf is the one place that would be ignored.
        const buffer = buffers.find((b) => b.id === m.bufferId)
        return !buffer || !isMutedBuffer(buffer, muted, mutedGroups)
      }),
    [mentions, dismissedTs, lastReadTs, buffers, muted, mutedGroups, read]
  )
  /** Where each is from: its server by name, or whose direct messages. */
  const placeName = (bufferId: string): string => {
    const buffer = buffers.find((b) => b.id === bufferId)
    const group = groups.find((g) => g.id === buffer?.groupId)
    if (group && group.kind !== 'account' && group.kind !== 'dms') return group.name
    const account = accounts.find((a) => a.id === buffer?.accountId)
    return account ? serviceLabel(account.service) : 'Elsewhere'
  }
  // Under a small heading each when more than one place is waiting, in the order they came.
  const runs = byPlace(unread, (m) => placeName(m.bufferId))
  const ordered = runs.flatMap((r) => r.items)

  useEscapeLayer(() => setOpen(false), open)

  // Clicking anywhere else puts it away, the way any other transient panel
  // behaves.
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => {
      document.removeEventListener('mousedown', close)
    }
  }, [open])

  // The arrow keys walk the list while it is open, Enter goes to the one they are on, and Delete ticks it off.
  useEffect(() => {
    if (!open) return
    setAt(0)
    const onKey = (e: KeyboardEvent): void => {
      const list = orderedRef.current
      if (list.length === 0) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setAt((i) => (i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length)
      } else if (e.key === 'Enter' && !(e.target as HTMLElement).closest('button')) {
        e.preventDefault()
        setAt((i) => {
          const m = list[Math.min(i, list.length - 1)]
          if (m) void jumpRef.current(m.bufferId, m.id)
          return i
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const jumpTo = async (bufferId: string, id: string): Promise<void> => {
    setOpen(false)
    await store.selectBuffer(bufferId, true)
    if (!document.querySelector(`[data-msg-id="${CSS.escape(id)}"]`)) {
      // The stored conversation goes back further than the view does; load
      // backwards until the message is actually there to scroll to.
      setJumping(true)
      try {
        if (!(await store.jumpToMessage(bufferId, id))) {
          store.toast('info', "Couldn't reach that message - it is a long way back")
          return
        }
      } finally {
        setJumping(false)
      }
    }
    store.setJumpTarget(id)
  }

  const orderedRef = useRef(ordered)
  orderedRef.current = ordered
  const jumpRef = useRef(jumpTo)
  jumpRef.current = jumpTo

  // A new release counts as one more thing waiting, so the badge shows it.
  const waiting = unread.length + (release ? 1 : 0)

  return (
    <div className="mentions-inbox" ref={box}>
      <IconButton
        name="alternate_email"
        title={
          release && unread.length === 0
            ? `moho ${release.version} is out`
            : unread.length > 0
              ? `${unread.length} unread mentions`
              : 'Mentions'
        }
        className={waiting > 0 ? 'has-mentions' : undefined}
        onClick={() => setOpen(!open)}
      />
      {/* Capped in the label rather than the list: past a certain number the
          exact count stops meaning anything, and a three-digit badge stops
          fitting on the button. */}
      {waiting > 0 && <span className="mentions-count">{waiting > 99 ? '99+' : waiting}</span>}

      {open && (
        <HeaderPopover anchor={box.current} width={380} className="mentions-panel" onClose={() => setOpen(false)}>
          <div className="mentions-panel-head small">
            <span className="muted">
              {jumping
                ? 'Loading older messages…'
                : unread.length === 0
                  ? 'Mentions'
                  : `${unread.length} unread ${unread.length === 1 ? 'mention' : 'mentions'}`}
            </span>
            {unread.length > 0 && (
              <button type="button" className="button quiet mentions-mark-all" onClick={() => setDismissedTs(Math.floor(Date.now() / 1000))}>
                <Icon name="done_all" size={15} /> Mark all read
              </button>
            )}
          </div>

          {/* A newer moho, at the top: not a mention, but the same kind of
              thing - a notice owed a look, gone once it has had one. The page
              it opens is that version's changelog. */}
          {release && (
            <div className="mention-row release-row">
              <button
                type="button"
                className="release-open"
                onClick={() => void window.moho.openExternal(release.url)}
                title={`Opens ${release.url}`}
              >
                <span className="release-icon">
                  <Icon name="new_releases" size={20} />
                </span>
                <span className="mention-body">
                  <span className="mention-head small">
                    <span className="mention-from">moho {release.version} is out</span>
                  </span>
                  <span className="mention-text small muted">
                    You have {__APP_VERSION__}. See what changed and download it.
                  </span>
                </span>
              </button>
              <IconButton
                name="close"
                size={16}
                title="Dismiss until the next release"
                onClick={() => setDismissedRelease(release.version)}
              />
            </div>
          )}

          {unread.length === 0 && !release && (
            <div className="mentions-panel-empty muted">
              <Icon name="alternate_email" size={24} />
              <span className="small">Nothing is waiting on you.</span>
            </div>
          )}

          <div className="mentions-panel-rows">
            {runs.map((run) => (
              <div key={run.place} className="mentions-run">
                {runs.length > 1 && <div className="mentions-run-head ellipsis">{run.place}</div>}
                {run.items.map((m) => {
                  const buffer = buffers.find((b) => b.id === m.bufferId)
                  // A mention whose conversation this client has since forgotten
                  // still shows: the message is the point, and hiding it because
                  // the buffer list moved on would lose the very thing collected.
                  const where = buffer ? bufferDisplayName(buffer.name) : 'a closed conversation'
                  return (
                    <div key={m.id} className={classes('mention-entry', 'compact', ordered[at]?.id === m.id && 'at')}>
                      <button type="button" className="mention-open" onClick={() => buffer && void jumpTo(buffer.id, m.id)} disabled={!buffer}>
                        <Avatar name={m.from} url={m.avatarUrl} size={28} accountId={accountOfBuffer(m.bufferId)} />
                        <span className="mention-body">
                          <span className="mention-head small">
                            <span className="mention-from">{m.from}</span>
                            <span className="muted ellipsis">in {where}</span>
                            {/* Relative, with the exact time on hover: the panel is
                                narrow, and "3h ago" is what decides whether a mention
                                still needs answering. */}
                            <span className="muted mention-when" title={formatFullTime(m.ts)}>
                              {formatRelativeTime(m.ts)}
                            </span>
                          </span>
                          <span className="mention-text-two small">{m.body}</span>
                        </span>
                      </button>
                      <span className="mention-actions">
                        <IconButton name="done" size={16} title="Mark this one read" onClick={() => setRead(withRead(read, m.id))} />
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {/* The way to the full page, which is the same list without the
              unread filter. The dropdown is for what is still owed an answer;
              everything that ever mentioned you is a different question, and
              this is the only route to it now that the rail has no tile. */}
          <button
            type="button"
            className="mentions-panel-all small"
            onClick={() => {
              setOpen(false)
              store.setActivePanel('')
              store.selectGroup(MENTIONS_GROUP_ID)
            }}
          >
            <Icon name="inbox" size={16} />
            See all mentions
          </button>
        </HeaderPopover>
      )}
    </div>
  )
}
