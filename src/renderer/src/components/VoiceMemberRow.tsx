import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { ContextMenu, useContextMenu, type MenuEntry } from './ContextMenu'
import { useChat, useIdSetPref, useStore } from '../state/hooks'
import { classes, hasDirectMessages, ignoreLabel } from '../lib/util'
import { profileHoverProps, releaseProfileHover } from '../lib/profilehover'
import { useEscapeLayer } from '../lib/layers'

/** How long the pointer rests on a streaming user before the preview opens. */
const PREVIEW_OPEN_MS = 280
/** Grace period after leaving the row or card before the preview closes. */
const PREVIEW_CLOSE_MS = 220
/** How long a fetched Discord stream thumbnail stays fresh in memory. */
const PREVIEW_TTL_MS = 15_000

const previewCache = new Map<string, { url: string | null; at: number }>()
/** Remembers each user's last non-zero local volume so unmuting restores it. */
const priorVolumes = new Map<string, number>()

export interface VoiceModPowers {
  canKick?: boolean
  canBan?: boolean
  canMute?: boolean
  canVoiceMute?: boolean
  canVoiceDeafen?: boolean
  canVoiceMove?: boolean
}

export type VoiceModAction = 'voice_mute' | 'voice_unmute' | 'voice_deafen' | 'voice_undeafen' | 'voice_disconnect'

export interface VoiceMemberRowProps {
  accountId: string
  service: string | undefined
  userId: string
  nick: string
  avatarUrl?: string
  isSelf?: boolean
  speaking?: boolean
  muted?: boolean
  deafened?: boolean
  streaming?: boolean
  video?: boolean
  /** Name of the voice channel this user is in, shown in the stream preview card. */
  channelName: string
  /** Whether the local user is currently connected to this voice channel. */
  inChannel: boolean
  /** A buffer id in this server/guild for opening ProfileCard and profile hover. */
  profileBufferId?: string
  /** Whether this user's stream is already being watched locally (Discord). */
  watchingStream?: boolean
  /** Whether per-user local volume/mute is supported on this protocol. */
  supportsUserVolume?: boolean
  /** Cache key for stream preview thumbnail fetches, e.g. `discord:id|guild:channel:user`. */
  streamPreviewKey?: string
  /** Fetches a stream preview image URL (data URL) when hovering a streaming user. */
  fetchStreamPreview?: () => Promise<string | null>
  /** Live MediaStream for this user if already in a LiveKit call (Stoat/Fluxer). */
  liveVideoStream?: MediaStream | null
  /** Start watching (or join & watch) this user's stream. */
  onWatchStream?: () => void
  /** Stop watching this user's stream. */
  onStopWatching?: () => void
  /** Disconnect self from the voice channel (shown in self context menu). */
  onDisconnectSelf?: () => void
  /** Guild/server moderation powers for the context menu. */
  perms?: VoiceModPowers
  /** Server-level moderation (kick, ban, timeout). */
  onModerate?: (action: 'kick' | 'ban' | 'mute') => void
  /** Voice-specific moderation (server mute/deafen/disconnect). */
  onVoiceModerate?: (action: VoiceModAction) => void
  /** Extra trailing badges/icons rendered after the user's name. */
  children?: ReactNode
}

/**
 * One participant listed under a voice channel in the channel rail.
 *
 * Shared across every Discord-format protocol (Discord, Stoat, Fluxer, Steam)
 * so hovering, clicking, stream previews, and right-click menus behave the
 * same way everywhere.
 */
export function VoiceMemberRow({
  accountId,
  service,
  userId,
  nick,
  avatarUrl,
  isSelf = false,
  speaking = false,
  muted = false,
  deafened = false,
  streaming = false,
  channelName,
  inChannel,
  profileBufferId,
  watchingStream = false,
  supportsUserVolume = false,
  streamPreviewKey,
  fetchStreamPreview,
  liveVideoStream,
  onWatchStream,
  onStopWatching,
  onDisconnectSelf,
  perms,
  onModerate,
  onVoiceModerate,
  children
}: VoiceMemberRowProps): JSX.Element {
  const store = useStore()
  const activeBufferId = useChat((s) => s.activeBufferId)
  const voicePrefs = useChat((s) => s.voicePrefs)
  const [, toggleBlocked, isBlocked] = useIdSetPref('blockedNicks')
  const { menu, open, close } = useContextMenu()

  const [previewAnchor, setPreviewAnchor] = useState<DOMRect | null>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearPreviewTimers = (): void => {
    if (openTimer.current) clearTimeout(openTimer.current)
    if (closeTimer.current) clearTimeout(closeTimer.current)
    openTimer.current = closeTimer.current = null
  }

  useEffect(() => () => clearPreviewTimers(), [])

  // Close stream preview if the user stops streaming or a context menu opens.
  useEffect(() => {
    if (!streaming || menu) {
      clearPreviewTimers()
      setPreviewAnchor(null)
    }
  }, [streaming, menu])

  const profileHover =
    !streaming && profileBufferId ? profileHoverProps(store, profileBufferId, nick, userId) : undefined

  const onMouseEnter = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (menu) return
    if (streaming) {
      releaseProfileHover()
      clearPreviewTimers()
      const rect = e.currentTarget.getBoundingClientRect()
      openTimer.current = setTimeout(() => {
        openTimer.current = null
        setPreviewAnchor(rect)
      }, PREVIEW_OPEN_MS)
    } else {
      profileHover?.onMouseEnter(e)
    }
  }

  const onMouseLeave = (): void => {
    if (streaming) {
      if (openTimer.current) {
        clearTimeout(openTimer.current)
        openTimer.current = null
      }
      if (closeTimer.current) clearTimeout(closeTimer.current)
      closeTimer.current = setTimeout(() => {
        closeTimer.current = null
        setPreviewAnchor(null)
      }, PREVIEW_CLOSE_MS)
    } else {
      profileHover?.onMouseLeave()
    }
  }

  const holdPreview = (): void => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  const closePreview = (): void => {
    clearPreviewTimers()
    setPreviewAnchor(null)
  }

  const openProfile = (anchor?: Element): void => {
    if (!profileBufferId) return
    closePreview()
    store.showProfile(profileBufferId, nick, userId, { anchor })
  }

  const blockKey = `${accountId}|${nick}`
  const blocked = isBlocked(blockKey)
  const currentVol = voicePrefs.userVolumes?.[userId] ?? 1
  const isLocallyMuted = currentVol <= 0.001

  const toggleLocalMute = (): void => {
    if (isLocallyMuted) {
      const restored = priorVolumes.get(userId) ?? 1
      store.setVoiceVolume(restored > 0.001 ? restored : 1, userId)
    } else {
      priorVolumes.set(userId, currentVol)
      store.setVoiceVolume(0, userId)
    }
  }

  const copyId = (): void => {
    void window.moho
      .copyText(userId)
      .then(() => store.toast('info', 'Copied User ID'))
      .catch(() => {})
  }

  const entries: MenuEntry[] = isSelf
    ? [
        ...(profileBufferId
          ? ([{ label: 'Profile', icon: 'person_search', onClick: () => openProfile() }] as MenuEntry[])
          : []),
        { separator: true },
        {
          label: 'Mute',
          icon: voicePrefs.micMuted ? 'mic_off' : 'mic',
          checked: voicePrefs.micMuted,
          onClick: () => void store.setVoiceMuted({ micMuted: !voicePrefs.micMuted })
        },
        {
          label: 'Deafen',
          icon: voicePrefs.deafened ? 'headset_off' : 'headset_mic',
          checked: voicePrefs.deafened,
          onClick: () => void store.setVoiceMuted({ deafened: !voicePrefs.deafened })
        },
        ...(inChannel && onDisconnectSelf
          ? ([
              {
                label: 'Disconnect',
                icon: 'call_end',
                danger: true,
                onClick: onDisconnectSelf
              }
            ] as MenuEntry[])
          : []),
        { separator: true },
        { label: 'Copy User ID', icon: 'badge', onClick: copyId }
      ]
    : [
        ...(profileBufferId
          ? ([{ label: 'Profile', icon: 'person_search', onClick: () => openProfile() }] as MenuEntry[])
          : []),
        ...(streaming && (watchingStream ? onStopWatching : onWatchStream)
          ? ([
              watchingStream && onStopWatching
                ? {
                    label: 'Stop Watching',
                    icon: 'stop_screen_share',
                    onClick: onStopWatching
                  }
                : {
                    label: inChannel ? 'Watch Stream' : 'Join & Watch Stream',
                    icon: 'screen_share',
                    onClick: onWatchStream!
                  }
            ] as MenuEntry[])
          : []),
        ...(activeBufferId
          ? ([
              {
                label: 'Mention',
                icon: 'alternate_email',
                onClick: () => store.startReply('', nick, '')
              }
            ] as MenuEntry[])
          : []),
        ...(hasDirectMessages(service)
          ? ([
              {
                label: 'Message',
                icon: 'chat',
                onClick: () => void store.openDirectMessage(accountId, userId, nick)
              }
            ] as MenuEntry[])
          : []),
        ...(service === 'discord'
          ? ([
              {
                label: 'Call',
                icon: 'call',
                onClick: () => {
                  store.toast('info', `Calling ${nick}…`)
                  void window.moho
                    .rpc<{ bufferId: string }>('callDiscordUser', { accountId, userId })
                    .then((r) => store.selectBuffer(r.bufferId))
                    .catch((e: Error) => store.toast('error', `Couldn't call: ${e.message}`))
                }
              }
            ] as MenuEntry[])
          : []),
        ...(supportsUserVolume
          ? ([
              { separator: true },
              {
                label: 'Mute',
                icon: isLocallyMuted ? 'volume_off' : 'volume_up',
                checked: isLocallyMuted,
                onClick: toggleLocalMute
              },
              {
                slider: true,
                label: 'User Volume',
                value: Math.round(currentVol * 100),
                min: 0,
                max: 200,
                step: 5,
                format: (v) => `${v}%`,
                onChange: (v) => {
                  if (v > 0) priorVolumes.set(userId, v / 100)
                  store.setVoiceVolume(v / 100, userId)
                }
              }
            ] as MenuEntry[])
          : []),
        ...(onVoiceModerate && (perms?.canVoiceMute || perms?.canVoiceDeafen || perms?.canVoiceMove)
          ? ([
              { separator: true },
              ...(perms.canVoiceMute
                ? ([
                    {
                      label: 'Server Mute',
                      icon: 'mic_off',
                      checked: muted,
                      onClick: () => onVoiceModerate(muted ? 'voice_unmute' : 'voice_mute')
                    }
                  ] as MenuEntry[])
                : []),
              ...(perms.canVoiceDeafen
                ? ([
                    {
                      label: 'Server Deafen',
                      icon: 'headset_off',
                      checked: deafened,
                      onClick: () => onVoiceModerate(deafened ? 'voice_undeafen' : 'voice_deafen')
                    }
                  ] as MenuEntry[])
                : []),
              ...(perms.canVoiceMove
                ? ([
                    {
                      label: 'Disconnect',
                      icon: 'call_end',
                      danger: true,
                      onClick: () => onVoiceModerate('voice_disconnect')
                    }
                  ] as MenuEntry[])
                : [])
            ] as MenuEntry[])
          : []),
        ...(onModerate && (perms?.canMute || perms?.canKick || perms?.canBan)
          ? ([
              { separator: true },
              ...(perms.canMute
                ? ([
                    {
                      label: 'Time out (10m)',
                      icon: 'schedule',
                      onClick: () => onModerate('mute')
                    }
                  ] as MenuEntry[])
                : []),
              ...(perms.canKick
                ? ([
                    {
                      label: 'Kick',
                      icon: 'logout',
                      danger: true,
                      onClick: () => onModerate('kick')
                    }
                  ] as MenuEntry[])
                : []),
              ...(perms.canBan
                ? ([
                    {
                      label: 'Ban',
                      icon: 'gavel',
                      danger: true,
                      onClick: () => onModerate('ban')
                    }
                  ] as MenuEntry[])
                : [])
            ] as MenuEntry[])
          : []),
        { separator: true },
        {
          label: ignoreLabel(accountId.split(':')[0], nick, blocked),
          icon: blocked ? 'check_circle' : 'block',
          danger: !blocked,
          onClick: () => {
            toggleBlocked(blockKey)
            store.setIgnored(accountId, userId || nick, !blocked, nick)
          }
        },
        { label: 'Copy User ID', icon: 'badge', onClick: copyId }
      ]

  return (
    <>
      <div
        className={classes('voice-member small', speaking && 'speaking', menu && 'menu-open')}
        role="button"
        tabIndex={0}
        onClick={(e) => {
          if (profileBufferId) openProfile(e.currentTarget)
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && profileBufferId) {
            e.preventDefault()
            openProfile(e.currentTarget)
          }
        }}
        onContextMenu={(e) => {
          closePreview()
          releaseProfileHover()
          open(e)
        }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <span className="voice-member-face">
          <Avatar name={nick} url={avatarUrl} size={20} accountId={accountId} />
        </span>
        <span className="ellipsis">{nick}</span>
        {isSelf && <span className="muted voice-you">you</span>}
        {children}
      </div>

      {previewAnchor && streaming && (
        <StreamPreviewPopover
          anchor={previewAnchor}
          accountId={accountId}
          nick={nick}
          avatarUrl={avatarUrl}
          channelName={channelName}
          isSelf={isSelf}
          inChannel={inChannel}
          watchingStream={watchingStream}
          cacheKey={streamPreviewKey}
          fetchPreview={fetchStreamPreview}
          liveVideoStream={liveVideoStream}
          onWatch={
            onWatchStream
              ? () => {
                  closePreview()
                  onWatchStream()
                }
              : undefined
          }
          onStopWatching={
            onStopWatching
              ? () => {
                  closePreview()
                  onStopWatching()
                }
              : undefined
          }
          onMouseEnter={holdPreview}
          onMouseLeave={onMouseLeave}
          onClose={closePreview}
        />
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} entries={entries} onClose={close} />}
    </>
  )
}

interface StreamPreviewProps {
  anchor: DOMRect
  accountId: string
  nick: string
  avatarUrl?: string
  channelName: string
  isSelf: boolean
  inChannel: boolean
  watchingStream: boolean
  cacheKey?: string
  fetchPreview?: () => Promise<string | null>
  liveVideoStream?: MediaStream | null
  onWatch?: () => void
  onStopWatching?: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
  onClose: () => void
}

function StreamPreviewPopover({
  anchor,
  accountId,
  nick,
  avatarUrl,
  channelName,
  isSelf,
  inChannel,
  watchingStream,
  cacheKey,
  fetchPreview,
  liveVideoStream,
  onWatch,
  onStopWatching,
  onMouseEnter,
  onMouseLeave,
  onClose
}: StreamPreviewProps): JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  const [thumbUrl, setThumbUrl] = useState<string | null>(() => {
    if (!cacheKey) return null
    const hit = previewCache.get(cacheKey)
    return hit && Date.now() - hit.at < PREVIEW_TTL_MS ? hit.url : null
  })
  const [loading, setLoading] = useState<boolean>(() => {
    if (!fetchPreview || liveVideoStream) return false
    if (!cacheKey) return true
    const hit = previewCache.get(cacheKey)
    return !(hit && Date.now() - hit.at < PREVIEW_TTL_MS)
  })

  useEscapeLayer(onClose)

  useEffect(() => {
    const away = (): void => onClose()
    window.addEventListener('scroll', away, true)
    return () => window.removeEventListener('scroll', away, true)
  }, [onClose])

  useEffect(() => {
    if (videoRef.current && liveVideoStream && videoRef.current.srcObject !== liveVideoStream) {
      videoRef.current.srcObject = liveVideoStream
    }
  }, [liveVideoStream])

  useEffect(() => {
    if (!fetchPreview || liveVideoStream) return
    if (cacheKey) {
      const hit = previewCache.get(cacheKey)
      if (hit && Date.now() - hit.at < PREVIEW_TTL_MS) {
        setThumbUrl(hit.url)
        setLoading(false)
        return
      }
    }
    let alive = true
    setLoading(true)
    void fetchPreview()
      .then((url) => {
        if (!alive) return
        if (cacheKey) previewCache.set(cacheKey, { url, at: Date.now() })
        setThumbUrl(url)
        setLoading(false)
      })
      .catch(() => {
        if (!alive) return
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [cacheKey, fetchPreview, liveVideoStream])

  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const gap = 10
    let left = anchor.right + gap
    if (left + width > vw - gap) left = anchor.left - width - gap
    left = Math.min(Math.max(gap, left), vw - width - gap)
    const top = Math.min(Math.max(gap, anchor.top - 16), vh - height - gap)
    setPlace({ left, top })
  }, [anchor, thumbUrl, loading])

  return createPortal(
    <div
      ref={cardRef}
      className="stream-preview-card"
      role="dialog"
      aria-label={`${nick}'s stream`}
      style={place ? { left: place.left, top: place.top } : { visibility: 'hidden' }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="stream-preview-frame">
        {liveVideoStream ? (
          <video ref={videoRef} className="stream-preview-media" autoPlay playsInline muted />
        ) : thumbUrl ? (
          <img src={thumbUrl} alt={`${nick}'s stream preview`} className="stream-preview-media" />
        ) : (
          <div className={classes('stream-preview-fallback', loading && 'loading')}>
            <Avatar name={nick} url={avatarUrl} size={40} accountId={accountId} />
            <span className="small muted">{loading ? 'Loading preview…' : 'Sharing screen'}</span>
          </div>
        )}
        <span className="stream-preview-live">LIVE</span>
      </div>

      <div className="stream-preview-foot">
        <div className="stream-preview-who">
          <Avatar name={nick} url={avatarUrl} size={24} accountId={accountId} />
          <div className="stream-preview-meta">
            <span className="stream-preview-nick ellipsis">{nick}</span>
            <span className="small muted ellipsis">
              <Icon name="volume_up" size={12} /> {channelName}
            </span>
          </div>
        </div>
        {!isSelf && (watchingStream && onStopWatching ? (
          <button type="button" className="button subtle small stream-preview-action" onClick={onStopWatching}>
            Stop Watching
          </button>
        ) : onWatch ? (
          <button type="button" className="button small stream-preview-action" onClick={onWatch}>
            {inChannel ? 'Watch Stream' : 'Join & Watch'}
          </button>
        ) : null)}
      </div>
    </div>,
    document.body
  )
}
