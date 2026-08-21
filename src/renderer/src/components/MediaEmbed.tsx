import { useState } from 'react'
import { Icon } from './Icon'
import { resolveMediaUrl } from '../lib/util'
import type { MediaItem } from '../lib/format'

/**
 * Inline preview for a single URL detected in a message body. Three kinds:
 *
 * - image: loads directly.
 * - video: a direct file link, click to load and play in place. No poster
 *   frame - producing one means fetching and decoding the file anyway, so
 *   there's no cheaper preview to show before that click.
 * - youtube: the public static thumbnail, opening the real video in the
 *   browser on click. A real <iframe> embed would work here, unlike in the
 *   original's Qt runtime - but it also silently loads YouTube's player and
 *   its cookies into the app the moment any message linking a video arrives.
 *   Keeping the thumbnail preserves the privacy posture deliberately.
 */
interface Props {
  item: MediaItem
  autoplay: boolean
  loop: boolean
  /** Only needed for the expired-Discord-link fallback. */
  bufferId?: string
  messageId?: string
  onOpenInDiscord?: (bufferId: string, messageId: string) => void
}

/**
 * Every cdn.discordapp.com / media.discordapp.net link Discord hands out is
 * signed with an ex=/is=/hm= query string that lapses roughly 24h after issue.
 * nobilis has no way to silently re-sign one (Discord's refresh-urls endpoint
 * rejects user-token requests outright), so once expired the only real fix is
 * opening the actual message in a real Discord session.
 */
function isDiscordAttachment(url: string): boolean {
  return /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//i.test(url)
}

export function MediaEmbed({
  item,
  autoplay,
  loop,
  bufferId,
  messageId,
  onOpenInDiscord
}: Props): JSX.Element | null {
  const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState(false)

  const open = (): void => void window.moho.openExternal(item.url)

  if (failed) {
    const expiredDiscord = isDiscordAttachment(item.url) && bufferId && messageId && onOpenInDiscord
    return (
      <div className="media-embed failed small muted">
        <Icon name="broken_image" size={16} />
        {expiredDiscord ? (
          <>
            <span>This attachment link has expired.</span>
            <button type="button" className="link-button" onClick={() => onOpenInDiscord(bufferId, messageId)}>
              Open in Discord
            </button>
          </>
        ) : (
          <button type="button" className="link-button" onClick={open}>
            Couldn&apos;t load — open the link
          </button>
        )}
      </div>
    )
  }

  if (item.kind === 'image') {
    // Animated formats honour the autoplay preference by swapping to a paused
    // <video>-less static render; browsers give no direct pause control over
    // an animated GIF, so "don't autoplay" is expressed by not loading it
    // until asked.
    const animated = /\.(gif|webp)(\?\S*)?$/i.test(item.url)
    if (animated && !autoplay && !playing) {
      return (
        <button type="button" className="media-embed paused" onClick={() => setPlaying(true)}>
          <Icon name="play_circle" size={28} />
          <span className="small">Play animation</span>
        </button>
      )
    }
    return (
      <img
        className="media-embed"
        src={resolveMediaUrl(item.url)}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        onClick={open}
      />
    )
  }

  if (item.kind === 'video') {
    if (!playing) {
      return (
        <button type="button" className="media-embed paused" onClick={() => setPlaying(true)}>
          <Icon name="play_circle" size={28} />
          <span className="small ellipsis">{item.url.split('/').pop()}</span>
        </button>
      )
    }
    return (
      <video
        className="media-embed"
        src={resolveMediaUrl(item.url)}
        controls
        autoPlay
        loop={loop}
        onError={() => setFailed(true)}
      />
    )
  }

  // youtube
  return (
    <button type="button" className="media-embed youtube" onClick={open} title={item.url}>
      <img
        src={`https://i.ytimg.com/vi/${item.youtubeId}/hqdefault.jpg`}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
      <span className="youtube-play">
        <Icon name="play_arrow" size={28} fill />
      </span>
    </button>
  )
}
