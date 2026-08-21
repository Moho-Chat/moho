import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import { MessageRow } from './MessageRow'
import { useChat, usePref, useStore } from '../state/hooks'
import { isChatKind } from '../lib/util'
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
  const [relativeTimestamps] = usePref<boolean>('display.relativeTimestamps', false)
  const [comfy] = usePref<string>('display.messageMode', 'classic')
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

  const scrollRef = useRef<HTMLDivElement>(null)
  const [anchored, setAnchored] = useState(true)
  const [missedCount, setMissedCount] = useState(0)

  const lastBufferRef = useRef(bufferId)
  const lastCountRef = useRef(messages.length)
  /** contentHeight before a load-more, so scroll position can be restored. */
  const preLoadHeightRef = useRef(0)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  // A buffer switch is a fresh view: land at the bottom, anchored, with no
  // carried-over "missed messages" count from the previous buffer.
  useLayoutEffect(() => {
    if (lastBufferRef.current === bufferId) return
    lastBufferRef.current = bufferId
    lastCountRef.current = messages.length
    setAnchored(true)
    setMissedCount(0)
    scrollToBottom()
  }, [bufferId, messages.length, scrollToBottom])

  useLayoutEffect(() => {
    const grew = messages.length - lastCountRef.current
    lastCountRef.current = messages.length
    if (grew <= 0) return

    // Older messages prepended by a load-more: hold the user's reading
    // position rather than letting the new content shove it down the page.
    if (preLoadHeightRef.current > 0) {
      const el = scrollRef.current
      if (el) el.scrollTop += el.scrollHeight - preLoadHeightRef.current
      preLoadHeightRef.current = 0
      return
    }

    if (anchored) scrollToBottom()
    else setMissedCount((n) => n + grew)
  }, [messages.length, anchored, scrollToBottom])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distance > UNANCHOR_THRESHOLD) setAnchored(false)
    else if (distance < REANCHOR_THRESHOLD) {
      setAnchored(true)
      setMissedCount(0)
    }

    // Ask for an older page once the user reaches the top, but only when the
    // view is actually scrollable - an empty or short buffer sits at
    // scrollTop 0 permanently and would otherwise request pages forever.
    if (el.scrollTop < 80 && el.scrollHeight > el.clientHeight && !isLoadingMore && messages.length > 0) {
      preLoadHeightRef.current = el.scrollHeight
      void store.loadMoreHistory(bufferId)
    }
  }, [bufferId, isLoadingMore, messages.length, store])

  const jumpToPresent = (): void => {
    setAnchored(true)
    setMissedCount(0)
    scrollToBottom('smooth')
  }

  // The divider marks the first message newer than the snapshot taken when the
  // buffer was opened; it deliberately doesn't move as more arrive.
  const dividerIndex = dividerTs > 0 ? messages.findIndex((m) => m.ts > dividerTs) : -1

  return (
    <div className="messagelist">
      <div className="messagelist-scroll" ref={scrollRef} onScroll={onScroll}>
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
              grouped={comfy === 'comfy' && isGrouped(messages, i)}
              comfy={comfy === 'comfy'}
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
