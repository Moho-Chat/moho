import { useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import { Avatar } from './Avatar'
import { ContextMenu, useContextMenu, type MenuEntry } from './ContextMenu'
import { MediaEmbed } from './MediaEmbed'
import { EmojiPicker } from './EmojiPicker'
import { RichText } from '../lib/richtext'
import { useChat, usePref, useStore } from '../state/hooks'
import { useSniffedTypes, sniffUrl } from '../lib/sniff'
import type { ChatMessage } from '../state/store'
import type { MessageBadge, MessageComponent, MessageReader } from '../../../shared/wire'
import {
  embedColor,
  extractCodeBlocks,
  extractMedia,
  extractQuoteBlocks,
  formatMessage,
  normalizeBBCode,
  youtubeId,
  stripCodeBlocks,
  stripEmbeddedUrls,
  stripQuoteBlocks,
  discordEmojiUrl,
  type ChannelIndex
} from '../lib/format'
import {
  classes,
  formatFullTime,
  formatRelativeTime,
  formatTime,
  hasDirectMessages,
  isChatKind,
  isReward,
  isWhisper,
  nickColor,
  resolveMediaUrl
} from '../lib/util'

/**
 * A badge, short enough to sit beside a name.
 *
 * Abbreviated rather than spelled out: a row of full words beside every nick
 * would be wider than the messages. The full text is the tooltip, and a badge
 * nobody here has a short form for keeps its own first letters rather than
 * being dropped - an unfamiliar badge still says the person has one.
 */
function badgeLabel(badge: MessageBadge): string {
  const short: Record<string, string> = {
    broadcaster: 'HOST',
    moderator: 'MOD',
    verified: '✓',
    subscriber: 'SUB',
    founder: 'FDR',
    og: 'OG',
    vip: 'VIP',
    staff: 'STAFF',
    sub_gifter: 'GIFT',
    // Not a title like the rest of these - a warning that whoever sent this
    // was using a device nobody has vouched for. Without its own short form
    // the fallback below would abbreviate the explanation into "SEN".
    unverified: '⚠'
  }
  return short[badge.type] ?? badge.text.slice(0, 3).toUpperCase()
}

/** A handful of one-click reactions on the hover toolbar. */
const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥']

export type MessageMode = 'classic' | 'comfy' | 'bubbles'

interface Props {
  message: ChatMessage
  bufferId: string
  service?: string
  /** Channel ids this client can resolve, for `<#id>` links in the body. */
  channels?: ChannelIndex
  grouped: boolean
  /**
   * How the log is drawn. `classic` is one line per message, `comfy` groups by
   * author with an avatar, `bubbles` is the phone-messaging shape: sides, not
   * columns.
   */
  mode: MessageMode
  /**
   * Whether this is the last message of its run by one author. Bubbles draw
   * their tail here and nowhere else, so a run reads as one turn in the
   * conversation rather than as several separate ones.
   */
  lastInRun: boolean
  relativeTimestamps: boolean
  mediaAutoplay: boolean
  mediaLoop: boolean
  contentSniffing: boolean
  /**
   * Who has read the conversation this far, drawn in the right gutter the way
   * Element does. Absent where the protocol publishes nothing, and where the
   * reader has turned the markers off.
   */
  readers?: MessageReader[]
  /**
   * How many replies this message has started, where it has started any.
   * Drawn as the way into the thread, which is the only way into one for a
   * root that nobody has answered inside the visible log.
   */
  threadReplies?: number
  /** Whether this row is being drawn inside the thread panel itself. */
  inThread?: boolean
}

/** How many faces fit before the row starts costing more than it says. */
const MAX_READER_FACES = 3

/**
 * The faces of everybody who has read this far.
 *
 * Overlapped rather than spaced, and capped, because this sits in a gutter
 * beside a message: a room of thirty people would otherwise draw thirty
 * avatars against one line and push the conversation off the screen. Past the
 * cap it becomes a count, and the full list of names is the tooltip either
 * way - which is the part somebody actually reads when they care who.
 */
function ReadMarkers({ readers }: { readers: MessageReader[] }): JSX.Element {
  const names = readers.map((r) => r.nick).join(', ')
  const shown = readers.slice(0, MAX_READER_FACES)
  return (
    <span className="read-markers" title={`Read by ${names}`} aria-label={`Read by ${names}`}>
      {shown.map((reader) => (
        <span key={reader.userId} className="read-marker">
          <Avatar name={reader.nick} url={reader.avatarUrl} size={14} />
        </span>
      ))}
      {readers.length > shown.length && (
        <span className="read-marker-more small muted">+{readers.length - shown.length}</span>
      )}
    </span>
  )
}

export function MessageRow({
  message,
  bufferId,
  service,
  channels,
  grouped,
  mode,
  lastInRun,
  relativeTimestamps,
  mediaAutoplay,
  mediaLoop,
  contentSniffing,
  readers,
  threadReplies,
  inThread
}: Props): JSX.Element {
  const store = useStore()
  const { menu, open, close } = useContextMenu()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.body)
  const [revealed, setRevealed] = useState<Record<number, boolean>>({})
  const [pickerOpen, setPickerOpen] = useState(false)
  const reactButtonRef = useRef<HTMLButtonElement>(null)

  const permissions = useChat((s) => s.matrixPermissions)[bufferId] || {}
  const smilieIndex = useChat((s) => s.smilieIndex)
  const bufferEmoji = useChat((s) => s.bufferEmoji)[bufferId] || []
  // Already the conversation with this person, so offering to open it would
  // be a menu entry that reselects the buffer you are reading.
  const inDirectMessage = useChat((s) => s.buffers).find((b) => b.id === bufferId)?.kind === 'dm'
  const sniffed = useSniffedTypes()
  // Colour is how IRC has always been written, and it is also how a bot
  // shouts. Somebody who wants the words without the decoration says so here
  // and the codes are removed instead of drawn.
  const [ircColours] = usePref<boolean>('irc.renderColours', true)

  const isSneedchat = service === 'sneedchat'
  // Discord, Sneedchat and Matrix support editing and deleting your own
  // messages; IRC has no such concept.
  const canEditDelete =
    !!message.isOwn && (service === 'discord' || service === 'sneedchat' || service === 'matrix')
  const canReact = service === 'discord' || service === 'matrix'
  const pinned = useChat((s) => s.pinnedMessages)[bufferId]?.includes(message.id) ?? false
  const isSystem = !isChatKind(message.kind)
  // Said to you rather than to the room. Drawn differently on purpose: the
  // whole risk with a private message is reading it as a public one.
  const whispered = isWhisper(message.kind)
  const reward = isReward(message.kind)
  // Both of the modes that draw an avatar column. Bubbles is otherwise
  // nothing like comfy, but it wants the same picture beside the same first
  // line of a group.
  const comfy = mode === 'comfy' || mode === 'bubbles'
  const bubbles = mode === 'bubbles'
  /**
   * Which side a bubble sits on.
   *
   * A system line takes no side: a join or a topic change was not said by
   * anybody, and putting it in a bubble would claim it was.
   */
  const own = bubbles && !isSystem && !!message.isOwn

  const attachments = message.attachments ?? []

  // The extraction passes each walk the same normalised body independently,
  // matching how the original structured this - one do-everything function
  // would have to interleave four unrelated concerns.
  const parts = useMemo(() => {
    const normalized = normalizeBBCode(message.body || '')
    const media = extractMedia(normalized, {
      contentSniffing,
      sniffed,
      onNeedSniff: sniffUrl
    })
    const codeBlocks = extractCodeBlocks(normalized)
    const quoteBlocks = extractQuoteBlocks(stripCodeBlocks(normalized))

    let body = stripEmbeddedUrls(normalized, media)
    body = stripCodeBlocks(body)
    body = stripQuoteBlocks(body)

    return {
      // A sender's own formatting, where the protocol carried any: Matrix
      // sends a formatted body alongside the plain one. Used instead of the
      // BBCode/markdown pass rather than as well as it - it is already
      // markup, and running it through a second syntax would mangle it. Not
      // trusted for being structured: RichText sanitises it exactly as it
      // sanitises everything else.
      //
      // Media, code and quote extraction still read the plain body above, so
      // link previews keep working on a formatted message.
      html:
        message.html ??
        formatMessage(body, {
          revealedSpoilers: revealed,
          isSneedchat,
          smilies: smilieIndex,
          channels,
          // Only IRC's own traffic is drawn with IRC's codes. Elsewhere they
          // are stripped, which is what the formatter does when not told.
          ircFormatting: service === 'irc' && ircColours ? 'render' : 'strip'
        }),
      media,
      codeBlocks,
      quoteBlocks
    }
  }, [message.body, message.html, contentSniffing, sniffed, revealed, isSneedchat, smilieIndex, channels, service, ircColours])

  const entries: MenuEntry[] = [
    // First, above what to do about the message: the question a right click
    // on somebody's line usually asks is who they are, and finding them in a
    // member list of four hundred to ask it is work nobody should have to do.
    ...(message.from && !isSystem && !message.isOwn
      ? ([
          {
            label: `Profile of ${message.from}`,
            icon: 'person_search',
            onClick: () => store.showProfile(bufferId, message.from, message.senderId)
          }
        ] as MenuEntry[])
      : []),
    { label: 'Reply', icon: 'reply', onClick: () => reply() },
    // Never hearing from them again, on every client this account uses -
    // Matrix keeps the list on the account rather than in one window, which
    // is the difference between blocking somebody and hiding them here.
    ...(service === 'matrix' && !isSystem && !message.isOwn && message.senderId
      ? ([
          {
            label: `Ignore ${message.from}`,
            icon: 'block',
            danger: true,
            onClick: () => {
              const account = store.accountFor(bufferId)
              if (account) store.setIgnored(account.id, message.senderId!, true)
            }
          }
        ] as MenuEntry[])
      : []),
    // What the room tells everyone to read first. Offered to everybody
    // rather than gated on a power level read here: the server decides, and
    // it refuses in words worth showing - hiding the action from somebody who
    // could have used it is the worse mistake.
    ...((service === 'matrix' || service === 'discord') && !isSystem
      ? ([
          {
            label: pinned ? 'Unpin from this conversation' : 'Pin to this conversation',
            icon: pinned ? 'keep_off' : 'push_pin',
            onClick: () => store.setPinned(bufferId, message.id, !pinned)
          }
        ] as MenuEntry[])
      : []),
    // Beside Reply because it is the same gesture aimed somewhere else, and
    // only where the service has whispers at all.
    ...(service === 'sneedchat' && !message.isOwn && message.from && !isSystem
      ? ([{ label: `Whisper ${message.from}`, icon: 'lock', onClick: () => store.startWhisper(message.from) }] as MenuEntry[])
      : []),
    // From the message rather than from a member list, because the person you
    // want to send something to is usually the one who just said something.
    ...(service === 'irc' && !message.isOwn && message.from && !isSystem
      ? ([
          {
            label: `Send a file to ${message.from}`,
            icon: 'upload_file',
            onClick: () => {
              const account = store.accountFor(bufferId)
              if (account) void store.sendFileTo(account.id, message.from)
            }
          }
        ] as MenuEntry[])
      : []),
    ...(canEditDelete
      ? ([
          {
            label: 'Edit',
            icon: 'edit',
            onClick: () => {
              setDraft(message.body)
              setEditing(true)
            }
          },
          {
            label: 'Delete',
            icon: 'delete',
            danger: true,
            onClick: () => void store.deleteMessage(bufferId, message.id)
          }
        ] as MenuEntry[])
      : []),
    ...(permissions.canRedactOthers && !message.isOwn
      ? ([
          {
            label: 'Delete (moderator)',
            icon: 'delete_forever',
            danger: true,
            onClick: () => void store.deleteMessage(bufferId, message.id)
          }
        ] as MenuEntry[])
      : []),
    ...(message.senderId && (permissions.canMute || permissions.canKick || permissions.canBan)
      ? ([{ separator: true } as MenuEntry] as MenuEntry[])
      : []),
    ...moderationEntries(message, permissions, bufferId, store),
    // Talking to somebody directly, from where they said the thing you want to
    // talk to them about. Only where the sender is somebody to open one with:
    // your own messages, and anything the server itself said, are not.
    ...(hasDirectMessages(service) && !inDirectMessage && !message.isOwn && message.from && !isSystem
      ? ([
          {
            label: `Message ${message.from}`,
            icon: 'chat',
            onClick: () => {
              const account = store.accountFor(bufferId)
              if (account) void store.openDirectMessage(account.id, message.senderId ?? '', message.from)
            }
          }
        ] as MenuEntry[])
      : []),
    ...(service === 'discord'
      ? ([
          {
            label: 'Open in Discord',
            icon: 'open_in_new',
            onClick: () => void store.openInDiscord(bufferId, message.id)
          }
        ] as MenuEntry[])
      : []),
    ...(message.failed
      ? ([{ label: 'Retry', icon: 'refresh', onClick: () => store.retrySend(message.id) }] as MenuEntry[])
      : [])
  ]

  function reply(): void {
    // What this becomes is the protocol's business, decided in the daemon:
    // Sneedchat's convention is an "@username," mention rather than IRC's
    // "nick: " prefix, while Discord, Matrix and Kick have real native
    // replies. All this does is name what is being answered.
    store.startReply(message.id, message.from, message.body)
  }

  const timeLabel = relativeTimestamps ? formatRelativeTime(message.ts) : formatTime(message.ts)

  /**
   * Which unfurled link belongs to which rich embed.
   *
   * A posted YouTube link produces both: the link itself, which unfurls to a
   * thumbnail, and Discord's own embed describing it - title, description,
   * colour. Drawn separately that is one video shown twice, once as a picture
   * and once as a headline underneath it. Drawn together it is what Discord
   * shows and what the person posting meant: a titled card with the video in
   * it.
   */
  const embedMedia = useMemo(() => {
    const claimed = new Map<number, (typeof parts.media)[number]>()
    const taken = new Set<string>()
    ;(message.embeds || []).forEach((embed, i) => {
      if (!embed.url) return
      const wanted = youtubeId(embed.url)
      const match = parts.media.find(
        (m) =>
          !taken.has(m.url) &&
          (m.url === embed.url || (!!wanted && m.youtubeId === wanted))
      )
      if (match) {
        claimed.set(i, match)
        taken.add(match.url)
      }
    })
    return { claimed, loose: parts.media.filter((m) => !taken.has(m.url)) }
  }, [message.embeds, parts.media])

  return (
    <>
      <div
        className={classes(
          'message-row',
          message.isHighlight && 'highlight',
          whispered && 'whisper',
          message.pending && 'pending',
          message.failed && 'failed',
          isSystem && 'system',
          reward && 'reward',
          grouped && 'grouped',
          comfy && 'comfy',
          bubbles && 'bubbles',
          own && 'own',
          bubbles && lastInRun && 'tail'
        )}
        // Addressable, so a search result can scroll to the message it found.
        data-msg-id={message.id}
        onContextMenu={open}
      >
        {/* Bubbles carry their own time inside, which is the whole point of
            the shape - so the gutter that reserves 42px for it on every other
            row would be 42px of nothing. */}
        {!bubbles && (
          <span className="message-time small muted" title={formatFullTime(message.ts)}>
            {grouped ? '' : timeLabel}
          </span>
        )}

        {/* The avatar column is reserved on every grouped row, not just the
            one that draws an avatar. Rendering this only for the first
            message of a group let the follow-ups slide left into the space
            the avatar would occupy, so a group's second and third lines sat
            out of line with its own first line - visible against any other
            client, where a group's text all shares one left edge. Wrapped
            lines never showed it because they wrap inside message-content,
            which was already in the right place. */}
        {comfy && !isSystem && (
          <span className="message-avatar">
            {!grouped &&
              (message.avatarUrl ? (
                <img src={resolveMediaUrl(message.avatarUrl)} alt="" />
              ) : (
                <span className="avatar-fallback" style={{ background: message.senderColor || nickColor(message.from) }}>
                  {message.from.slice(0, 1).toUpperCase()}
                </span>
              ))}
          </span>
        )}

        <div className="message-content">
          {/* Your own bubble is not labelled with your own name - the side it
              is on already says it, which is the point of having sides. */}
          {/* The service's own colour where it gives one, and the one derived
              from the nick where it does not. Kick sets everybody's, and a
              chat where every name is the same colour is one nobody can
              follow.

              Badges beside it, because on Kick who is talking is half the
              message: a moderator, a two-year subscriber and a stranger read
              as three different things. */}
          {/* Name and badges in one element, because the name is a block in
              comfy and bubble layouts - badges as siblings of it fell to the
              next line and sat in with the message text. They belong to the
              byline, so they live in it. */}
          {!grouped && !isSystem && !own && (
            <span className="message-byline">
              <span className="message-from" style={{ color: message.senderColor || nickColor(message.from) }}>
                {message.isAction ? `* ${message.from}` : message.from}
              </span>
              {message.badges?.map((badge) => (
                <span
                  key={badge.type}
                  className={`sender-badge small ${badge.type}`}
                  title={badge.count ? `${badge.text} — ${badge.count} months` : badge.text}
                >
                  {badgeLabel(badge)}
                </span>
              ))}
            </span>
          )}

          {/* Said in words as well as in styling. Italics and a tinted edge
              say "not like the others", which is not the same as saying what
              it is - and a private message being mistaken for a public one is
              the failure worth spending a line on. Shown on every whisper,
              grouped or not, because grouping is exactly when the run of
              messages above it might have been public. */}
          {whispered && (
            <span className="whisper-tag small">
              <Icon name="lock" size={11} />
              {/* Who it went to is in the line itself for one we sent - the
                  daemon writes the "@name" the site writes - so the tag says
                  only what kind of message this is. It used to name
                  `message.from`, which on our own whisper is us. */}
              <span>whisper</span>
            </span>
          )}

          {/* A reply names the message it answers; a threaded message names
              the thread it is in. The second is a button, because a thread is
              somewhere you can go - unless this is already the thread, where
              it would only reopen what is on screen. */}
          {message.replyTo &&
            (message.replyTo.thread && !inThread ? (
              <button
                type="button"
                className="reply-preview thread-link small muted"
                onClick={() => void store.openThreadPanel(bufferId, message.replyTo!.id)}
              >
                <Icon name="forum" size={13} />
                <span>In thread</span>
                {message.replyTo.body && <span className="ellipsis">{message.replyTo.body}</span>}
              </button>
            ) : (
              <div className="reply-preview small muted">
                <Icon name={message.replyTo.thread ? 'forum' : 'reply'} size={13} />
                <span className="reply-from" style={{ color: nickColor(message.replyTo.from) }}>
                  {message.replyTo.from}
                </span>
                <span className="ellipsis">{message.replyTo.body}</span>
              </div>
            ))}

          {editing ? (
            <input
              className="text-field"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false)
                if (e.key === 'Enter') {
                  void store.editMessage(bufferId, message.id, draft)
                  setEditing(false)
                }
              }}
              onBlur={() => setEditing(false)}
            />
          ) : (
            parts.html && (
              <span className="message-body selectable">
                <RichText
                  html={parts.html}
                  onRevealSpoiler={(i) => setRevealed((r) => ({ ...r, [i]: true }))}
                  // Following a channel link moves the rail too: the channel
                  // is usually in the same guild, but a cross-guild link is
                  // exactly the case where landing on a list that isn't
                  // showing it would be baffling.
                  onOpenChannel={(id) => void store.selectBuffer(id, true)}
                  onOpenLink={(url) => store.followDeepLink(url)}
                />
                {message.edited && <span className="edited-tag small muted"> (edited)</span>}
              </span>
            )
          )}

          {parts.quoteBlocks.map((quote, i) => (
            <blockquote key={`q${i}`} className="quote-block selectable">
              {quote}
            </blockquote>
          ))}

          {parts.codeBlocks.map((code, i) => (
            <pre key={`c${i}`} className="code-block selectable">
              {code}
            </pre>
          ))}

          {(message.embeds || []).map((embed, i) => (
            <div
              key={`e${i}`}
              className="rich-embed selectable"
              style={{ borderLeftColor: embedColor(embed.color) || 'var(--outline-strong)' }}
            >
              {embed.title &&
                (embed.url ? (
                  <a
                    className="rich-embed-title"
                    href={embed.url}
                    onClick={(ev) => {
                      ev.preventDefault()
                      void window.moho.openExternal(embed.url!)
                    }}
                  >
                    {embed.title}
                  </a>
                ) : (
                  <div className="rich-embed-title">{embed.title}</div>
                ))}
              {embed.description && (
                <div className="rich-embed-desc small">
                  <RichText
                    html={formatMessage(embed.description, { channels })}
                    onOpenChannel={(id) => void store.selectBuffer(id, true)}
                  onOpenLink={(url) => store.followDeepLink(url)}
                  />
                </div>
              )}
              {/* The thing the embed is about, inside the card describing it
                  rather than repeated below it. */}
              {embedMedia.claimed.has(i) && (
                <div className="rich-embed-media">
                  <MediaEmbed
                    item={embedMedia.claimed.get(i)!}
                    autoplay={mediaAutoplay}
                    loop={mediaLoop}
                    bufferId={bufferId}
                    messageId={message.id}
                    from={message.from}
                    onOpenInDiscord={(b, m) => void store.openInDiscord(b, m)}
                  />
                </div>
              )}
            </div>
          ))}

          {(attachments.length > 0 || embedMedia.loose.length > 0) && (
            <div className="media-row">
              {/* Files nobilis described: mimetype and dimensions known up
                  front, so these lay out without waiting on bytes. */}
              {attachments.map((att, i) => (
                <MediaEmbed
                  key={`att-${i}-${att.path || att.url || att.filename}`}
                  attachment={att}
                  autoplay={mediaAutoplay}
                  loop={mediaLoop}
                  bufferId={bufferId}
                  messageId={message.id}
                  from={message.from}
                  onOpenInDiscord={(b, m) => void store.openInDiscord(b, m)}
                  onRefresh={(b, m) => store.refreshAttachments(b, m)}
                />
              ))}
              {/* Links someone typed, unfurled from the body. Still needed
                  alongside attachments: a pasted image URL is not an
                  attachment, and pre-existing scrollback predates the
                  attachment list and carries its media inline. */}
              {embedMedia.loose.map((item) => (
                <MediaEmbed
                  key={item.url}
                  item={item}
                  autoplay={mediaAutoplay}
                  loop={mediaLoop}
                  bufferId={bufferId}
                  messageId={message.id}
                  from={message.from}
                  onOpenInDiscord={(b, m) => void store.openInDiscord(b, m)}
                />
              ))}
            </div>
          )}

          {/* What the message is for, on a great many bot messages: the
              prose is a caption and the button is the thing. Above the
              reactions because it belongs to the message rather than being a
              response to it. */}
          {(message.components?.length ?? 0) > 0 && (
            <MessageControls
              components={message.components!}
              bufferId={bufferId}
              messageId={message.id}
            />
          )}

          {(message.reactions?.length ?? 0) > 0 && (
            <div className="reaction-row">
              {message.reactions!.map((r) => (
                <button
                  key={r.emoji}
                  type="button"
                  className={classes('reaction-pill', r.me && 'mine')}
                  onClick={() => void store.toggleReaction(bufferId, message.id, r.emoji, !r.me)}
                  title={r.emoji}
                >
                  <ReactionEmoji emoji={r.emoji} animated={r.animated} />
                  <span className="small">{r.count}</span>
                </button>
              ))}
              {canReact && (
                <button
                  type="button"
                  className="reaction-pill add"
                  title="Add a reaction"
                  onClick={() => setPickerOpen(true)}
                >
                  <Icon name="add_reaction" size={14} />
                </button>
              )}
            </div>
          )}

          {message.failed && (
            <button
              type="button"
              className="send-failed small"
              onClick={() => store.retrySend(message.id)}
              title={message.errorText}
            >
              <Icon name="error" size={13} /> Failed to send — retry
            </button>
          )}

          {/* Inside the bubble, at its foot. On a phone the time is part of
              the bubble rather than a column beside it, and a column is
              exactly what cannot exist once messages sit on both sides. */}
          {bubbles && !isSystem && (
            <span className="bubble-time small" title={formatFullTime(message.ts)}>
              {timeLabel}
            </span>
          )}

          {/* The way into a thread from the message it grew out of. A count
              rather than a label, because the number is what makes somebody
              open it - "3 replies" is an invitation and "thread" is furniture. */}
          {!inThread && !!threadReplies && (
            <button
              type="button"
              className="thread-open small"
              onClick={() => void store.openThreadPanel(bufferId, message.id)}
            >
              <Icon name="forum" size={13} />
              {threadReplies === 1 ? '1 reply' : `${threadReplies} replies`}
            </button>
          )}
        </div>

        {/* Who has read this far. Element puts these against the last message
            each person has reached, which is the only placement that answers
            the question people actually ask of them - not "did they see this
            one" but "where has everybody got to". */}
        {readers && readers.length > 0 && <ReadMarkers readers={readers} />}

        {/* Hover toolbar: quick reactions, add-reaction, reply, more. */}
        <div className="hover-toolbar">
          {canReact &&
            QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="toolbar-button"
                title={`React ${emoji}`}
                onClick={() => void store.toggleReaction(bufferId, message.id, emoji, true)}
              >
                {emoji}
              </button>
            ))}
          {canReact && (
            <button
              ref={reactButtonRef}
              type="button"
              className="toolbar-button"
              title="Add a reaction"
              onClick={() => setPickerOpen(true)}
            >
              <Icon name="add_reaction" size={15} />
            </button>
          )}
          <button type="button" className="toolbar-button" title="Reply" onClick={reply}>
            <Icon name="reply" size={15} />
          </button>
          <button type="button" className="toolbar-button" title="More" onClick={open}>
            <Icon name="more_horiz" size={15} />
          </button>
        </div>
      </div>

      {pickerOpen && (
        <EmojiPicker
          anchor={reactButtonRef.current}
          customEmoji={bufferEmoji}
          accountId={store.accountFor(bufferId)?.id}
          onSelect={(emoji) => {
            void store.toggleReaction(bufferId, message.id, emoji, true)
            setPickerOpen(false)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} entries={entries} onClose={close} />}
    </>
  )
}

/**
 * A Discord custom reaction; a plain Unicode reaction is just the character
 * itself.
 *
 * nobilis stores these wrapped as `<:name:id>` - the same shape a message body
 * carries - and only unwraps them at the point it calls Discord's reaction
 * endpoint. Matching only the bare `name:id` therefore matched nothing, and
 * every custom reaction on every message rendered as its literal token beside
 * the count.
 */
function ReactionEmoji({ emoji }: { emoji: string; animated?: boolean }): JSX.Element {
  const custom = emoji.match(/^<?a?:?([A-Za-z0-9_~]{2,32}):(\d+)>?$/)
  if (!custom) return <span>{emoji}</span>
  return <img className="reaction-emoji" src={discordEmojiUrl(custom[2])} alt={custom[1]} />
}

function moderationEntries(
  message: ChatMessage,
  permissions: { canKick?: boolean; canBan?: boolean; canMute?: boolean },
  bufferId: string,
  store: ReturnType<typeof useStore>
): MenuEntry[] {
  // Targeted at the sender's real protocol id, never their display name -
  // display names collide and can be changed at will.
  const userId = message.senderId
  if (!userId) return []
  const call = (method: string): void => {
    const account = store.accountFor(bufferId)
    if (!account) return
    void window.moho
      .rpc(method, { accountId: account.id, bufferId, userId })
      .catch((e: Error) => store.toast('error', e.message))
  }
  const out: MenuEntry[] = []
  if (permissions.canMute)
    out.push({ label: 'Mute sender', icon: 'volume_off', onClick: () => call('muteMatrixMember') })
  if (permissions.canKick)
    out.push({ label: 'Kick sender', icon: 'logout', danger: true, onClick: () => call('kickMatrixMember') })
  if (permissions.canBan) {
    out.push({ label: 'Ban sender', icon: 'gavel', danger: true, onClick: () => call('banMatrixMember') })
    // Reachable only from here, not the member list: a banned user is no
    // longer a member, so their scrollback is the one place left to find them.
    out.push({ label: 'Unban sender', icon: 'lock_open', onClick: () => call('unbanMatrixMember') })
  }
  return out
}

/**
 * The buttons and menus a service put on a message.
 *
 * Drawn in the rows they were laid out in, because that is information: a bot
 * that put five buttons on one row and one underneath meant the last one to
 * stand apart, and flattening them into a line loses which is which.
 *
 * A link button is a link and nothing else - it opens a page and tells nobody
 * it was pressed - so it is drawn as one rather than sent back to the service.
 */
function MessageControls({
  components,
  bufferId,
  messageId
}: {
  components: MessageComponent[]
  bufferId: string
  messageId: string
}): JSX.Element {
  const store = useStore()
  const rows = new Map<number, MessageComponent[]>()
  for (const c of components) {
    const row = c.row ?? 0
    rows.set(row, [...(rows.get(row) ?? []), c])
  }

  return (
    <div className="component-rows">
      {[...rows.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([row, controls]) => (
          <div key={row} className="component-row">
            {controls.map((c, i) =>
              c.kind === 'select' ? (
                <select
                  key={c.customId ?? i}
                  className="component-select"
                  defaultValue=""
                  disabled={c.disabled}
                  onChange={(e) => {
                    if (!c.customId || !e.target.value) return
                    store.useComponent(bufferId, messageId, c.customId, true, [e.target.value])
                  }}
                >
                  <option value="" disabled>
                    {c.placeholder || 'Choose…'}
                  </option>
                  {(c.options ?? []).map((o) => (
                    <option key={o.value} value={o.value} title={o.description}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : c.style === 'link' && c.url ? (
                <a
                  key={c.url}
                  className="component-button link"
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {c.emoji && <ReactionEmoji emoji={c.emoji} />}
                  <span className="ellipsis">{c.label || c.url}</span>
                  <Icon name="open_in_new" size={13} />
                </a>
              ) : (
                <button
                  key={c.customId ?? i}
                  type="button"
                  className={classes('component-button', c.style)}
                  disabled={c.disabled || !c.customId}
                  onClick={() => c.customId && store.useComponent(bufferId, messageId, c.customId, false, [])}
                >
                  {c.emoji && <ReactionEmoji emoji={c.emoji} />}
                  <span className="ellipsis">{c.label || 'Press'}</span>
                </button>
              )
            )}
          </div>
        ))}
    </div>
  )
}
