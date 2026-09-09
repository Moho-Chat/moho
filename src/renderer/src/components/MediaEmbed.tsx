import { useState } from 'react'
import { Icon } from './Icon'
import { Lightbox } from './Lightbox'
import { resolveMediaUrl } from '../lib/util'
import type { MediaItem } from '../lib/format'
import type { Attachment } from '../../../shared/wire'

/**
 * Inline preview for one piece of media, from either of two sources:
 *
 * - an Attachment, described by nobilis (a real file someone attached), or
 * - a MediaItem, detected by unfurling a URL someone typed into a message.
 *
 * The two differ in how much is known. An attachment arrives with a mimetype,
 * a filename and usually intrinsic dimensions, so its box can be reserved
 * before any bytes load and the message list doesn't reflow underneath the
 * reader. An unfurled link is a guess from the URL alone, so it can only be
 * laid out once the image reports its own size.
 */
interface Props {
  item?: MediaItem
  attachment?: Attachment
  autoplay: boolean
  loop: boolean
  /** Only needed for the expired-Discord-link fallback. */
  bufferId?: string
  messageId?: string
  /** Shown in the expanded view's header, so it stays attributable. */
  from?: string
  onOpenInDiscord?: (bufferId: string, messageId: string) => void
  /** Re-signs this message's links by asking Discord for it again. */
  onRefresh?: (bufferId: string, messageId: string) => Promise<void>
}

/**
 * Every cdn.discordapp.com / media.discordapp.net link Discord hands out is
 * signed with an ex=/is=/hm= query string that lapses roughly 24h after issue.
 * nobilis re-signs one by asking Discord for the message again, so an expired
 * link is a reload rather than a dead end.
 */
function isDiscordAttachment(url: string): boolean {
  return /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//i.test(url)
}

/**
 * `ex=` is the link's expiry as a hex unix timestamp. Reading it means a stale
 * link is known before it is requested - which matters once a cached preview
 * exists, because then the image never fails to load and nothing would
 * otherwise reveal that the original is gone.
 */
function linkExpired(url: string): boolean {
  const ex = /[?&]ex=([0-9a-f]+)/i.exec(url)?.[1]
  if (!ex) return false
  return Date.now() / 1000 >= parseInt(ex, 16)
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * The shape an unmeasured picture is given to sit in.
 *
 * Four by three, because it has to be something and something wrong in the
 * ordinary direction is less jarring than a tall box round a wide photograph.
 * It is a starting size rather than a final one - see `measured` below - so
 * being wrong costs one small adjustment rather than a permanent letterbox.
 */
const UNKNOWN_RATIO = '4 / 3'

export function MediaEmbed({
  item,
  attachment,
  autoplay,
  loop,
  bufferId,
  messageId,
  from,
  onOpenInDiscord,
  onRefresh
}: Props): JSX.Element | null {
  const [failed, setFailed] = useState(false)
  /**
   * The locally cached preview is gone, so fall back to the original.
   *
   * This is routine rather than exceptional: the daemon caps its thumbnail
   * cache and sweeps the oldest files, while the stored message goes on naming
   * the file that was swept. Treating that as a broken attachment reports a
   * perfectly good link as expired and shows a broken image in place of a
   * picture that could be fetched.
   */
  const [previewGone, setPreviewGone] = useState(false)
  /** What the picture turned out to be, once it had loaded enough to say. */
  const [seen, setSeen] = useState<{ width: number; height: number } | null>(null)
  const [playing, setPlaying] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')

  // An attachment knows its own kind; an unfurled link only has a guess.
  const kind = attachment?.kind ?? item?.kind ?? 'file'
  // Local cache first: for Sneedchat and Matrix the remote URL is unreachable
  // from here (Tor, or an access token we don't hold), so the path nobilis
  // fetched is the only way to show anything. Discord supplies no path and
  // its CDN URL loads directly.
  const fullSrc = attachment ? attachment.path || attachment.url || '' : item?.url || ''
  // A server-generated thumbnail is enough for a preview and much cheaper -
  // until it has been swept, after which the original is all there is.
  const previewSrc = (!previewGone && attachment?.thumbnailPath) || fullSrc
  const openTarget = attachment?.url || fullSrc

  const open = (): void => void window.moho.openExternal(openTarget)

  /**
   * The size the picture is going to be, decided before it arrives.
   *
   * Where the service told us - Discord and Matrix both send dimensions with
   * an attachment - this is exact. Where it did not, which is every link a
   * message merely contains, the box was previously nothing at all: a row of
   * no height that became three hundred pixels the moment the image decoded,
   * shoving everything below it. On a channel where most messages are
   * pictures that is not an occasional jolt, it is the reading experience.
   *
   * So an unmeasured picture gets a placeholder shape to sit in until it can
   * be measured, and measures itself on load - one change, at a size the list
   * has already made room for, instead of one from nothing.
   */
  const measured = seen ?? (attachment?.width && attachment?.height
    ? { width: attachment.width, height: attachment.height }
    : null)
  const ratio = { aspectRatio: measured ? `${measured.width} / ${measured.height}` : UNKNOWN_RATIO }

  const canRefresh = !!(isDiscordAttachment(openTarget) && bufferId && messageId && onRefresh)

  const refresh = (): void => {
    if (!canRefresh) return
    setRefreshing(true)
    setRefreshError('')
    void onRefresh(bufferId!, messageId!)
      .then(() => {
        // The daemon broadcasts the re-signed attachment, which arrives as a
        // prop; clearing the failure lets the new link be attempted.
        setFailed(false)
      })
      .catch((e: Error) => setRefreshError(e.message))
      .finally(() => setRefreshing(false))
  }

  if (failed || !fullSrc) {
    // A cached preview outlives the signed link, so an expired attachment
    // still has something to show - click it to fetch the original again
    // rather than being told it is gone.
    const preview = previewGone ? '' : attachment?.thumbnailPath
    if (preview && canRefresh) {
      return (
        <button
          type="button"
          className="media-embed expired"
          style={ratio}
          title={refreshError || 'Link expired — click to reload from Discord'}
          onClick={refresh}
        >
          <img src={resolveMediaUrl(preview)} alt={attachment?.filename || ''} loading="lazy" />
          <span className="expired-overlay small">
            <Icon name={refreshing ? 'hourglass_empty' : 'refresh'} size={18} />
            {refreshing ? 'Reloading…' : refreshError || 'Click to reload'}
          </span>
        </button>
      )
    }
    return (
      <div className="media-embed failed small muted">
        <Icon name="broken_image" size={16} />
        {canRefresh ? (
          <>
            <span>{refreshError || 'This attachment link has expired.'}</span>
            <button type="button" className="link-button" disabled={refreshing} onClick={refresh}>
              {refreshing ? 'Reloading…' : 'Reload'}
            </button>
            {onOpenInDiscord && (
              <button
                type="button"
                className="link-button"
                onClick={() => onOpenInDiscord(bufferId!, messageId!)}
              >
                Open in Discord
              </button>
            )}
          </>
        ) : (
          <button type="button" className="link-button" onClick={open}>
            {attachment?.filename || "Couldn't load — open the link"}
          </button>
        )}
      </div>
    )
  }

  if (kind === 'image') {
    // Browsers give no pause control over an animated GIF, so "don't autoplay"
    // is expressed by not loading it until asked.
    const animated =
      attachment?.mimetype === 'image/gif' || /\.(gif|webp)(\?\S*)?$/i.test(fullSrc)
    if (animated && !autoplay && !playing) {
      return (
        <button type="button" className="media-embed paused" onClick={() => setPlaying(true)}>
          <Icon name="play_circle" size={28} />
          <span className="small">Play animation</span>
        </button>
      )
    }

    // Show the cheap local copy until asked for the original.
    const showingPreview = !!attachment?.thumbnailPath && !previewGone && !playing
    const stale = canRefresh && linkExpired(openTarget)

    // Clicking a picture opens it large. The inline copy stays the cheap
    // preview either way - only the expanded view loads the original.
    const load = (): void => {
      if (stale) {
        // A lapsed link would expand into a broken box, so re-sign first and
        // only open once there is something that will actually load.
        setRefreshing(true)
        setRefreshError('')
        void onRefresh!(bufferId!, messageId!)
          .then(() => setExpanded(true))
          .catch((e: Error) => setRefreshError(e.message))
          .finally(() => setRefreshing(false))
        return
      }
      setExpanded(true)
    }

    return (
      <span className="media-embed-wrap" style={ratio}>
        <img
          className="media-embed"
          style={ratio}
          src={resolveMediaUrl(showingPreview ? previewSrc : fullSrc)}
          alt={attachment?.filename || ''}
          title={refreshError || attachment?.filename}
          loading="lazy"
          // Its real shape, the first moment there is one to have. Only for
          // pictures nobody told us about: where the service sent dimensions
          // they are already right, and re-measuring would swap an exact box
          // for a rounded one.
          onLoad={(e) => {
            if (measured) return
            const img = e.currentTarget
            if (img.naturalWidth && img.naturalHeight) {
              setSeen({ width: img.naturalWidth, height: img.naturalHeight })
            }
          }}
          // A failed preview means the cached file went away, which says
          // nothing about the link. Only a failure of the original itself is
          // the attachment actually being unreachable.
          onError={() => (showingPreview ? setPreviewGone(true) : setFailed(true))}
          onClick={load}
        />
        {showingPreview && stale && (
          <span className="expired-overlay small">
            <Icon name={refreshing ? 'hourglass_empty' : 'refresh'} size={16} />
            {refreshing ? 'Reloading…' : refreshError || 'Click to reload'}
          </span>
        )}
        {expanded && (
          <Lightbox
            source={{
              kind: 'image',
              src: resolveMediaUrl(fullSrc),
              externalUrl: openTarget,
              filename: attachment?.filename,
              width: attachment?.width,
              height: attachment?.height,
              from
            }}
            onClose={() => setExpanded(false)}
          />
        )}
      </span>
    )
  }

  if (kind === 'video') {
    // Played in the log, the way every other client does it. The mimetype is
    // deliberately not consulted: Discord serves plenty of .mp4 files as
    // video/quicktime, which canPlayType refuses outright while the browser
    // then plays the file perfectly well once it looks inside. Letting it try
    // and handling the failure is the honest test.
    return (
      <>
        <span className="media-embed-wrap video" style={ratio}>
          <video
            className="media-embed"
            style={ratio}
            src={resolveMediaUrl(fullSrc)}
            controls
            // Enough to draw the first frame and know how long it is, without
            // pulling megabytes for every video in a scrolled-past backlog.
            preload="metadata"
            loop={loop}
            playsInline
            onError={() => setFailed(true)}
          />
          <button
            type="button"
            className="video-expand"
            title="Expand"
            onClick={() => setExpanded(true)}
          >
            <Icon name="fullscreen" size={16} />
          </button>
        </span>
        {expanded && (
          <Lightbox
            source={{
              kind: 'video',
              src: resolveMediaUrl(fullSrc),
              externalUrl: openTarget,
              filename: attachment?.filename,
              loop,
              from
            }}
            onClose={() => setExpanded(false)}
          />
        )}
      </>
    )
  }

  if (kind === 'audio') {
    return (
      <div className="media-embed audio">
        <span className="small ellipsis">{attachment?.filename || 'audio'}</span>
        <audio src={resolveMediaUrl(fullSrc)} controls onError={() => setFailed(true)} />
      </div>
    )
  }

  if (kind === 'file') {
    // Nothing to preview - show what it is and let the user open it.
    return (
      <button type="button" className="media-embed file-card" onClick={open}>
        <Icon name="description" size={22} />
        <span className="file-meta">
          <span className="ellipsis">{attachment?.filename || 'attachment'}</span>
          {attachment?.size !== undefined && (
            <span className="small muted">{humanSize(attachment.size)}</span>
          )}
        </span>
        <Icon name="open_in_new" size={16} />
      </button>
    )
  }

  // youtube - a detected link, never an attachment
  return (
    <button type="button" className="media-embed youtube" onClick={open} title={fullSrc}>
      <img
        src={`https://i.ytimg.com/vi/${item?.youtubeId}/hqdefault.jpg`}
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
