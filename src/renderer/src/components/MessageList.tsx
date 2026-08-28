import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import { MessageRow, type MessageMode } from './MessageRow'
import { CallView } from './CallView'
import { useChat, usePref, useStore } from '../state/hooks'
import { bufferDisplayName, isChatKind } from '../lib/util'
import type { ChannelIndex } from '../lib/format'
import type { ChatMessage } from '../state/store'

/**
 * A log-style message view - nick-coloured senders, timestamps, a highlighted
 * row background for mentions - rather than chat bubbles, matching IRC client
 * convention.
 *
 * Scrolling is Discord-style "sticky": the view stays pinned to the bottom
 * while the user is near it, and stops auto-scrolling the moment they scroll
 * away, surfacing a "Jump to present" bar instead. Two thresholds rather than
 * one, because a single cutoff makes that bar flicker when the user parks the
 * scroll position right on it.
 *
 * What keeps it pinned is a ResizeObserver on the content, not a count of
 * messages. Watching the count got this wrong three ways, all of which left
 * the reader stranded above new traffic with no sign anything had arrived:
 * an image or video finishing its load grows the page *after* the message it
 * belongs to is on screen; a filtered-out join/part arriving grows nothing
 * while the underlying list grows; and once a buffer reaches the store's
 * 500-message cap the count stops changing at all, so a busy channel simply
 * stopped following once you had read it long enough. Height changing is the
 * thing that actually needs answering, so height is what is watched.
 */
const UNANCHOR_THRESHOLD = 250
const REANCHOR_THRESHOLD = 100
/** Consecutive messages from the same author inside this window are grouped. */
const GROUP_WINDOW_SECS = 300

export function MessageList(): JSX.Element {
  const store = useStore()
  const bufferId = useChat((s) => s.activeBufferId)
  const messagesByBuffer = useChat((s) => s.messagesByBuffer)
  const loadingMore = useChat((s) => s.loadingMore)
  const dividerTsByBuffer = useChat((s) => s.dividerTsByBuffer)
  const jumpTarget = useChat((s) => s.jumpTarget)
  const [relativeTimestamps] = usePref<boolean>('display.relativeTimestamps', false)
  const [comfy] = usePref<MessageMode>('display.messageMode', 'comfy')
  const [mediaAutoplay] = usePref<boolean>('media.autoplay', true)
  const [mediaLoop] = usePref<boolean>('media.loop', true)
  const [contentSniffing] = usePref<boolean>('media.contentSniffing', true)
  const accounts = useChat((s) => s.accounts)
  const buffers = useChat((s) => s.buffers)
  const service = accounts.find(
    (a) => a.id === buffers.find((b) => b.id === bufferId)?.accountId
  )?.service

  const dividerTs = dividerTsByBuffer[bufferId] || 0
  const isLoadingMore = !!loadingMore[bufferId]

  // Message-kind filters. nobilis always emits and persists every message
  // regardless of kind, so which to render is purely a client decision and
  // toggling one takes effect immediately - no reconnect, no replay.
  const [showJoin] = usePref<boolean>('irc.showJoinMessages', true)
  const [showPart] = usePref<boolean>('irc.showPartMessages', true)
  const [showNick] = usePref<boolean>('irc.showNickChanges', true)
  const [showTopic] = usePref<boolean>('irc.showTopicChanges', true)
  const [showMode] = usePref<boolean>('irc.showModeChanges', true)
  const [showMxJoin] = usePref<boolean>('matrix.showJoinMessages', true)
  const [showMxInvite] = usePref<boolean>('matrix.showInviteMessages', true)
  const [showMxKick] = usePref<boolean>('matrix.showKickMessages', true)
  const [showMxQuit] = usePref<boolean>('matrix.showQuitMessages', true)
  const [blockedNicks] = usePref<string[]>('blockedNicks', [])

  const accountId = buffers.find((b) => b.id === bufferId)?.accountId || ''
  const all = messagesByBuffer[bufferId] || []

  const messages = useMemo(() => {
    const allowed: Record<string, boolean> = {
      join: showJoin,
      part: showPart,
      nick: showNick,
      topic: showTopic,
      mode: showMode,
      matrixJoin: showMxJoin,
      matrixInvite: showMxInvite,
      matrixKick: showMxKick,
      matrixQuit: showMxQuit
    }
    return all.filter((m) => {
      if (accountId && blockedNicks.includes(`${accountId}|${m.from}`)) return false
      const kind = m.kind || 'chat'
      if (isChatKind(kind) || kind === 'system') return true
      return allowed[kind] !== false
    })
  }, [
    all, accountId, blockedNicks,
    showJoin, showPart, showNick, showTopic, showMode,
    showMxJoin, showMxInvite, showMxKick, showMxQuit
  ])

  /**
   * Every channel this client could open, by the service's own id.
   *
   * Not scoped to the account: a Discord channel id is unique everywhere, and
   * people do link channels in other guilds. Built once here rather than per
   * row - a busy guild is hundreds of channels and a screen is dozens of
   * messages, and the identity has to stay stable or every row re-formats its
   * body on every render.
   */
  const channelMentions = useMemo<ChannelIndex>(() => {
    const index: ChannelIndex = {}
    for (const b of buffers) {
      if (b.remoteId) index[b.remoteId] = { bufferId: b.id, name: bufferDisplayName(b.name) }
    }
    return index
  }, [buffers])

  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [anchored, setAnchored] = useState(true)
  const [missedCount, setMissedCount] = useState(0)

  const lastBufferRef = useRef(bufferId)
  /** The newest message already accounted for, so growth is told from a prepend. */
  const lastIdRef = useRef<string | undefined>(messages[messages.length - 1]?.id)
  /** Read by the resize observer, which must not re-subscribe on every flip. */
  const anchoredRef = useRef(true)
  /** contentHeight before a load-more, so scroll position can be restored. */
  const preLoadHeightRef = useRef(0)
  /** A jumped-to message to keep in view while the page settles around it. */
  const holdRef = useRef('')

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  const anchor = useCallback((on: boolean) => {
    anchoredRef.current = on
    setAnchored(on)
  }, [])

  /**
   * Anything that makes the page taller while pinned scrolls it back down: a
   * new message, an image settling into its real size, an embed unfurling.
   *
   * Not conditioned on a load-more being in flight, even though that growth is
   * above the reader rather than below. A load-more can only be asked for from
   * the top of the list, and being at the top of a list long enough to have
   * one is not being pinned to its bottom - so the two do not overlap in
   * practice, and a latch that had to be cleared correctly would be one more
   * way for the pin to get stuck off, which is the bug being fixed.
   */
  useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      // A jump holds its target the same way the tail is held: rows above it
      // keep growing as their pictures arrive, and each one pushes the thing
      // you asked to see further down the page.
      const held = holdRef.current
      if (held) {
        scrollRef.current
          ?.querySelector(`[data-msg-id="${CSS.escape(held)}"]`)
          ?.scrollIntoView({ block: 'center' })
        return
      }
      if (anchoredRef.current) scrollToBottom()
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [scrollToBottom])


  /**
   * Somewhere else in the log has been asked for - a search result.
   *
   * Un-pinning first is the whole point of doing this here. Newly loaded rows
   * keep growing for seconds as their pictures arrive, and while the view is
   * pinned every one of those growths pulls it back to the bottom - so a
   * scroll issued from outside is undone a moment after it lands.
   */
  useEffect(() => {
    if (!jumpTarget) return
    const row = scrollRef.current?.querySelector(`[data-msg-id="${CSS.escape(jumpTarget)}"]`)
    if (!row) return
    anchor(false)
    setMissedCount(0)
    row.scrollIntoView({ block: 'center', behavior: 'smooth' })
    row.classList.add('found')
    // Held against the page settling: pictures in the rows above keep landing
    // for a second or two afterwards, and each one pushes this row down.
    holdRef.current = jumpTarget
    // Deliberately not cleaned up on re-run. This effect re-runs whenever the
    // log changes, which is constantly, and cancelling these each time left
    // the highlight on the row permanently and the hold on forever.
    setTimeout(() => row.classList.remove('found'), 2000)
    setTimeout(() => {
      if (holdRef.current === jumpTarget) holdRef.current = ''
    }, 2500)
    store.setJumpTarget('')
  }, [jumpTarget, messages, anchor, store])

  // A buffer switch is a fresh view: land at the bottom, anchored, with no
  // carried-over "missed messages" count from the previous buffer.
  useLayoutEffect(() => {
    if (lastBufferRef.current === bufferId) return
    lastBufferRef.current = bufferId
    lastIdRef.current = messages[messages.length - 1]?.id
    preLoadHeightRef.current = 0
    anchor(true)
    setMissedCount(0)
    scrollToBottom()
  }, [bufferId, messages, anchor, scrollToBottom])

  useLayoutEffect(() => {
    // Older messages prepended by a load-more: hold the user's reading
    // position rather than letting the new content shove it down the page.
    // Only once the page has actually grown, since this effect also runs on
    // the render that merely put the loading row up.
    if (preLoadHeightRef.current > 0) {
      const el = scrollRef.current
      if (el && el.scrollHeight > preLoadHeightRef.current) {
        el.scrollTop += el.scrollHeight - preLoadHeightRef.current
        preLoadHeightRef.current = 0
      } else if (!isLoadingMore) {
        // Came back with nothing - the top of the buffer. Released here so
        // the next real page isn't measured against a height from minutes
        // ago and restored to the wrong place.
        preLoadHeightRef.current = 0
      }
    }

    // A prepend leaves the newest message where it was, so this only counts
    // arrivals - which is what the "N new messages" bar is about.
    const lastId = messages[messages.length - 1]?.id
    if (lastId === lastIdRef.current) return
    const previous = lastIdRef.current
    lastIdRef.current = lastId
    if (anchoredRef.current) return

    const seen = previous ? messages.findIndex((m) => m.id === previous) : -1
    // Not found means the message the count was last taken from has been
    // trimmed off the top; one is the honest floor rather than a guess.
    setMissedCount((n) => n + (seen >= 0 ? messages.length - 1 - seen : 1))
  }, [messages, isLoadingMore])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distance > UNANCHOR_THRESHOLD) anchor(false)
    else if (distance < REANCHOR_THRESHOLD) {
      anchor(true)
      setMissedCount(0)
    }

    // Ask for an older page once the user reaches the top, but only when the
    // view is actually scrollable - an empty or short buffer sits at
    // scrollTop 0 permanently and would otherwise request pages forever.
    if (el.scrollTop < 80 && el.scrollHeight > el.clientHeight && !isLoadingMore && messages.length > 0) {
      preLoadHeightRef.current = el.scrollHeight
      void store.loadMoreHistory(bufferId)
    }
  }, [anchor, bufferId, isLoadingMore, messages.length, store])

  const jumpToPresent = (): void => {
    anchor(true)
    setMissedCount(0)
    scrollToBottom('smooth')
  }

  // The divider marks the first message newer than the snapshot taken when the
  // buffer was opened; it deliberately doesn't move as more arrive.
  const dividerIndex = dividerTs > 0 ? messages.findIndex((m) => m.ts > dividerTs) : -1

  return (
    <div className="messagelist">
      {/* Above the log and outside the scroller. Who is talking is only
          useful while it can be seen, and a panel that scrolled away with
          the backlog would be gone the moment anybody read anything. */}
      <CallView bufferId={bufferId} />
      <div className="messagelist-scroll" ref={scrollRef} onScroll={onScroll}>
        {/* One wrapper so the whole log has a single measurable height; the
            observer above needs an element that grows with the content, which
            the scroll container itself never does. */}
        <div className="messagelist-content" ref={contentRef}>
          {isLoadingMore && (
            <div className="messagelist-loading muted small">Loading older messages…</div>
          )}
          {messages.map((msg, i) => (
            <div key={msg.id}>
              {i === dividerIndex && (
                <div className="new-divider">
                  <span>New</span>
                </div>
              )}
              <MessageRow
                message={msg}
                bufferId={bufferId}
                service={service}
                channels={channelMentions}
                grouped={comfy !== 'classic' && isGrouped(messages, i)}
                mode={comfy}
                // The newest message is always the end of its own run.
                lastInRun={i === messages.length - 1 || !isGrouped(messages, i + 1)}
                relativeTimestamps={relativeTimestamps}
                mediaAutoplay={mediaAutoplay}
                mediaLoop={mediaLoop}
                contentSniffing={contentSniffing}
              />
            </div>
          ))}
          {messages.length === 0 && (
            <div className="messagelist-empty muted">No messages here yet.</div>
          )}
        </div>
      </div>

      {!anchored && (
        <button type="button" className="jump-to-present" onClick={jumpToPresent}>
          <Icon name="arrow_downward" size={16} />
          {missedCount > 0
            ? `${missedCount} new message${missedCount === 1 ? '' : 's'}`
            : 'Jump to present'}
        </button>
      )}
    </div>
  )
}

function isGrouped(messages: ChatMessage[], index: number): boolean {
  if (index === 0) return false
  const prev = messages[index - 1]
  const cur = messages[index]
  return (
    prev.from === cur.from &&
    !cur.isAction &&
    !prev.isAction &&
    isChatKind(cur.kind) &&
    isChatKind(prev.kind) &&
    cur.ts - prev.ts < GROUP_WINDOW_SECS
  )
}
