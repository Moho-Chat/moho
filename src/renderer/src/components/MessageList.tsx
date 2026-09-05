import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import { MessageRow, type MessageMode } from './MessageRow'
import { LiveCards } from './LiveCards'
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

/**
 * How close to the bottom counts as being back at it.
 *
 * Only ever consulted about a scroll the reader made downwards, so it decides
 * "did they mean to come back", not "are they near enough to be dragged".
 */
const REANCHOR_THRESHOLD = 100

/**
 * How far the view has to move before it counts as having moved at all.
 *
 * Scroll positions are fractional, and a browser will report a pixel of drift
 * of its own accord while content settles. Without a floor that drift reads as
 * a deliberate scroll upwards.
 */
const SCROLL_JITTER = 2

/** One scroll event, and enough of the one before it to say what happened. */
export interface ScrollFrame {
  /** How far the bottom of the content sits below the bottom of the view. */
  distance: number
  top: number
  lastTop: number
  height: number
  lastHeight: number
  /** How tall the window onto the list is, and was. */
  viewport: number
  lastViewport: number
}

/**
 * What a scroll event means for the pin: to release it, hold it, or take it
 * back.
 *
 * The rule is that the reader decides, in both directions. Scrolling up at all
 * releases the pin - there is no distance to travel first, because a reader
 * who has moved the view upwards has said what they want, and making them earn
 * it over some number of pixels means a channel busy enough to keep firing the
 * pin's own scroll-to-bottom can undo the attempt before it ever gets there.
 * That is a fight the reader cannot win, and it is why this is not a threshold.
 *
 * Coming back is the same rule the other way: the pin is only taken back by a
 * scroll the reader made *downwards* that arrives near the bottom. Proximity
 * on its own is not consent - content is removed from the top of a busy buffer
 * as it is trimmed, and that alone can carry a stationary reader to within any
 * distance of the bottom.
 *
 * Which leaves telling a reader's scroll from the page moving underneath one.
 * Height is one tell: when content is removed the browser clamps the position
 * down by what it lost, which looks exactly like scrolling up and is not, so a
 * position that fell by no more than the page shrank is not movement at all.
 *
 * The window onto the list is the other, and it was missing. A scroller sitting
 * at its bottom cannot stay there when it is made taller - the position can
 * never exceed the content less the window, so the browser drops it by however
 * much the window gained. Resizing the pane therefore read as scrolling up by
 * exactly that much, releasing the pin and offering to jump back to a present
 * nobody had left. The allowance is the same idea either way: a fall no larger
 * than what the page lost or the window gained is the layout moving, not the
 * reader.
 *
 * And it cuts both ways. Making the pane *smaller* pushes the position the
 * other direction - the bottom stays in view by the position rising - which
 * reads as the reader scrolling back down. For somebody parked in history
 * near the bottom that would take the pin back and drag them to the present,
 * losing the place they went looking for. So a rise no larger than what the
 * window lost is not the reader coming back either.
 */
export function anchorVerdict(frame: ScrollFrame): 'release' | 'hold' | 'take' {
  const shrank = Math.max(0, frame.lastHeight - frame.height)
  const opened = Math.max(0, frame.viewport - frame.lastViewport)
  const closed = Math.max(0, frame.lastViewport - frame.viewport)
  const moved = frame.top - frame.lastTop
  if (moved < -shrank - opened - SCROLL_JITTER) return 'release'
  if (moved > closed + SCROLL_JITTER && frame.distance < REANCHOR_THRESHOLD) return 'take'
  return 'hold'
}

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
  // Kick's chat carries a great deal nobody said, and on a busy channel it can
  // outnumber the conversation. Separable for the same reason IRC's join and
  // part lines are: each is worth having, and not all at once.
  const [showRedemptions] = usePref<boolean>('kick.showRedemptions', true)
  const [showSubs] = usePref<boolean>('kick.showSubscriptions', true)
  const [showRaids] = usePref<boolean>('kick.showRaids', true)
  const [showPolls] = usePref<boolean>('kick.showPolls', true)
  const [showStream] = usePref<boolean>('kick.showStreamEvents', true)
  const [showKickMod] = usePref<boolean>('kick.showModeration', true)
  const [showReaders] = usePref<boolean>('matrix.showReadReceipts', true)
  const [blockedNicks] = usePref<string[]>('blockedNicks', [])
  const readers = useChat((s) => s.readersByBuffer)[bufferId]


  const accountId = buffers.find((b) => b.id === bufferId)?.accountId || ''
  const syncing = !!buffers.find((b) => b.id === bufferId)?.syncing
  const all = messagesByBuffer[bufferId] || []

  /**
   * How many replies each thread has, by the message it grew from.
   *
   * Counted from what is loaded rather than asked for: Matrix does send a
   * summary with the root, but only on the sync that carried it, so a room
   * read back from scrollback would show nothing. This undercounts a thread
   * whose replies are older than the loaded window, which is the honest
   * failure - it says "at least this many", never "none" for a live one.
   */
  const threadReplies = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const m of all) {
      if (m.replyTo?.thread) counts[m.replyTo.id] = (counts[m.replyTo.id] ?? 0) + 1
    }
    return counts
  }, [all])

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
      matrixQuit: showMxQuit,
      reward: showRedemptions,
      sub: showSubs,
      raid: showRaids,
      poll: showPolls,
      stream: showStream,
      moderation: showKickMod
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
    showMxJoin, showMxInvite, showMxKick, showMxQuit,
    showRedemptions, showSubs, showRaids, showPolls, showStream, showKickMod
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
  /** Where the view was at the last scroll, to tell moving up from growing. */
  const lastTopRef = useRef(0)
  /** And how tall it was, to tell moving up from the page losing content. */
  const lastHeightRef = useRef(0)
  /** And how tall the window onto it was, for the same reason. */
  const lastViewportRef = useRef(0)

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
    // And the window onto it. Making the pane taller does not necessarily
    // change the content's height at all, so watching only the content meant
    // the one case that moves the position without touching it - a resize -
    // was the case nothing put back.
    if (scrollRef.current) ro.observe(scrollRef.current)
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
    const top = el.scrollTop
    const height = el.scrollHeight
    const viewport = el.clientHeight
    const verdict = anchorVerdict({
      distance: height - top - viewport,
      top,
      lastTop: lastTopRef.current,
      height,
      lastHeight: lastHeightRef.current,
      viewport,
      lastViewport: lastViewportRef.current
    })
    lastTopRef.current = top
    lastHeightRef.current = height
    lastViewportRef.current = viewport

    // Reading away un-pins the view, and reading back pins it again; nothing
    // else moves it. Both halves of that have been got wrong here before, and
    // in opposite directions.
    //
    // Releasing used to be a matter of distance, which cannot tell a reader
    // moving up from the bottom moving away: a message arriving makes the page
    // taller, which puts the bottom exactly as far off as scrolling up by the
    // height of that message would have, so a busy channel un-pinned itself
    // and offered to fix something nobody had done.
    //
    // Then taking it back stayed a matter of distance, which is the same
    // mistake wearing the other hat - and worse, because while the pin is off
    // it is holding the reader's place in the history they went looking for.
    // Being near the bottom is not asking to be dragged to it.
    if (verdict === 'release') anchor(false)
    else if (verdict === 'take') {
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

  // Reset alongside the buffer: the position in one conversation says nothing
  // about the next, and a stale one would read the first scroll there as a
  // jump upwards.
  useEffect(() => {
    lastTopRef.current = scrollRef.current?.scrollTop ?? 0
    lastHeightRef.current = scrollRef.current?.scrollHeight ?? 0
    lastViewportRef.current = scrollRef.current?.clientHeight ?? 0
  }, [bufferId])

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
      {/* Over the log rather than in it: a poll is one question being
          answered while the chat keeps moving underneath, and a line in the
          log would scroll away mid-vote. */}
      <LiveCards bufferId={bufferId} />
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
                readers={showReaders ? readers?.[msg.id] : undefined}
                threadReplies={threadReplies[msg.id]}
              />
            </div>
          ))}
          {/* A room that has been joined but not yet heard from is not an
              empty room, and saying "no messages here yet" of one would be a
              claim about its contents that nothing has established. */}
          {messages.length === 0 &&
            (syncing ? (
              <div className="messagelist-empty muted">
                <span className="spinner" />
                <span>Synchronising with the server…</span>
              </div>
            ) : (
              <div className="messagelist-empty muted">No messages here yet.</div>
            ))}
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
