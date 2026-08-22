import { useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import { ContextMenu, useContextMenu, type MenuEntry } from './ContextMenu'
import { MediaEmbed } from './MediaEmbed'
import { EmojiPicker } from './EmojiPicker'
import { RichText } from '../lib/richtext'
import { useChat, useStore } from '../state/hooks'
import { useSniffedTypes, sniffUrl } from '../lib/sniff'
import type { ChatMessage } from '../state/store'
import {
  embedColor,
  extractCodeBlocks,
  extractMedia,
  extractQuoteBlocks,
  formatMessage,
  normalizeBBCode,
  stripCodeBlocks,
  stripEmbeddedUrls,
  stripQuoteBlocks
} from '../lib/format'
import {
  classes,
  formatFullTime,
  formatRelativeTime,
  formatTime,
  isChatKind,
  nickColor,
  resolveMediaUrl
} from '../lib/util'

/** A handful of one-click reactions on the hover toolbar. */
const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥']

interface Props {
  message: ChatMessage
  bufferId: string
  service?: string
  grouped: boolean
  comfy: boolean
  relativeTimestamps: boolean
  mediaAutoplay: boolean
  mediaLoop: boolean
  contentSniffing: boolean
}

export function MessageRow({
  message,
  bufferId,
  service,
  grouped,
  comfy,
  relativeTimestamps,
  mediaAutoplay,
  mediaLoop,
  contentSniffing
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
  const sniffed = useSniffedTypes()

  const isSockchat = service === 'sockchat'
  // Discord, Sneedchat and Matrix support editing and deleting your own
  // messages; IRC has no such concept.
  const canEditDelete =
    !!message.isOwn && (service === 'discord' || service === 'sockchat' || service === 'matrix')
  const canReact = service === 'discord' || service === 'matrix'
  const isSystem = !isChatKind(message.kind)

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
      html: formatMessage(body, { revealedSpoilers: revealed, isSockchat, smilies: smilieIndex }),
      media,
      codeBlocks,
      quoteBlocks
    }
  }, [message.body, contentSniffing, sniffed, revealed, isSockchat, smilieIndex])

  const entries: MenuEntry[] = [
    { label: 'Reply', icon: 'reply', onClick: () => reply() },
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
    // Sneedchat's own convention is an "@username," mention rather than IRC's
    // "nick: " prefix; Discord and Matrix have real native replies.
    store.startReply(message.id, message.from, message.body)
  }

  const timeLabel = relativeTimestamps ? formatRelativeTime(message.ts) : formatTime(message.ts)

  return (
    <>
      <div
        className={classes(
          'message-row',
          message.isHighlight && 'highlight',
          message.pending && 'pending',
          message.failed && 'failed',
          isSystem && 'system',
          grouped && 'grouped',
          comfy && 'comfy'
        )}
        onContextMenu={open}
      >
        <span className="message-time small muted" title={formatFullTime(message.ts)}>
          {grouped ? '' : timeLabel}
        </span>

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
                <span className="avatar-fallback" style={{ background: nickColor(message.from) }}>
                  {message.from.slice(0, 1).toUpperCase()}
                </span>
              ))}
          </span>
        )}

        <div className="message-content">
          {!grouped && !isSystem && (
            <span className="message-from" style={{ color: nickColor(message.from) }}>
              {message.isAction ? `* ${message.from}` : message.from}
            </span>
          )}

          {message.replyTo && (
            <div className="reply-preview small muted">
              <Icon name="reply" size={13} />
              <span className="reply-from" style={{ color: nickColor(message.replyTo.from) }}>
                {message.replyTo.from}
              </span>
              <span className="ellipsis">{message.replyTo.body}</span>
            </div>
          )}

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
                  <RichText html={formatMessage(embed.description)} />
                </div>
              )}
            </div>
          ))}

          {(attachments.length > 0 || parts.media.length > 0) && (
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
              {parts.media.map((item) => (
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
        </div>

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
 * A Discord custom reaction arrives as "name:id"; a plain Unicode reaction is
 * just the character itself.
 */
function ReactionEmoji({ emoji, animated }: { emoji: string; animated?: boolean }): JSX.Element {
  const custom = emoji.match(/^(.+):(\d+)$/)
  if (!custom) return <span>{emoji}</span>
  return (
    <img
      className="reaction-emoji"
      src={`https://cdn.discordapp.com/emojis/${custom[2]}.${animated ? 'gif' : 'png'}?size=44`}
      alt={custom[1]}
    />
  )
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
