import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { Icon, IconButton } from './Icon'
import { ivsAbr, ivsLoader } from '../lib/ivsplaylist'
import { autoCeiling, captionTrack, menuOrder, renditionLabel, renditionOf, type CaptionTrack, type Rendition } from '../lib/streamplayer'
import { useEscapeLayer } from '../lib/layers'
import { VideoStage } from './VideoStage'
import { fitTiles } from './CallStage'
import { useChat, usePref, useStore } from '../state/hooks'
import { bufferDisplayName } from '../lib/util'
import { StageWindow, STREAM_WINDOW_NAME } from './stage/StageWindow'

/**
 * A Kick or a Twitch channel's stream, in the surface a call uses.
 *
 * The other half of the picture this window can show. A call is real-time
 * media negotiated with somebody and arrives as a `MediaStream` on
 * `srcObject`; a stream is one-to-many HLS off a CDN and arrives as a playlist
 * that has to be demuxed into Media Source Extensions - hls.js does that, and
 * it is the only thing here that a call does not also need.
 *
 * Everything above the pipe is shared: the frame, the corner it retreats to,
 * the minimise, the sizing. Which is the point - this is not a player, it is
 * the same video surface with a third source feeding it.
 *
 * Receiving only. Nothing here broadcasts, and there is nobody else in it: a
 * stream has one picture, and the grid a call draws would be a grid of one.
 */

/** What automatic choice of rendition may go up to: a picture this size beside a chat has no use for more. */
const AUTO_MAX_HEIGHT = 720

/**
 * How far behind the newest segment the player settles, in seconds.
 *
 * In seconds because hls.js counts the other way in multiples of the playlist's target duration, and Kick's
 * playlists say six seconds for segments that are two: "three segments" was eighteen seconds behind, which is
 * where most of the delay between the broadcaster and the picture came from. With the prefetched segments
 * (see lib/ivsplaylist.ts) this is a few seconds behind the broadcaster, and no catch-up speed: playing a little
 * fast to close the gap was measured to stall.
 */
const LIVE_SYNC_SECONDS = 4
const LIVE_MAX_LATENCY_SECONDS = 10

/** Where the numbers of captions carried inside the video start, clear of the playlist's own. */
const IN_VIDEO = 1000

/** The renditions of a player's playlist, as the choices are made from them. */
function renditionsOf(player: Hls): Rendition[] {
  return player.levels.map((l) => ({ height: l.height, frameRate: Number(l.attrs?.['FRAME-RATE']) || undefined, bitrate: l.bitrate }))
}

interface MenuChoice {
  label: string
  detail?: string
  checked: boolean
  onClick: () => void
}

/** A short list drawn over the picture, since a popped-out window is a document of its own and a menu in this one would open in the wrong place. */
function StreamMenu({ title, choices, onClose }: { title: string; choices: MenuChoice[]; onClose: () => void }): JSX.Element {
  useEscapeLayer(onClose)
  return (
    <>
      <div className="stream-menu-scrim" onClick={onClose} />
      <div className="context-menu stream-menu" role="menu" aria-label={title}>
        <div className="stream-menu-title small muted">{title}</div>
        {choices.map((c) => (
          <button
            key={c.label}
            type="button"
            role="menuitemradio"
            aria-checked={c.checked}
            className="context-menu-item"
            onClick={() => {
              c.onClick()
              onClose()
            }}
          >
            <span className="context-menu-label">{c.label}</span>
            {c.detail && <span className="small muted">{c.detail}</span>}
            {c.checked && <Icon name="check" size={16} className="context-menu-check" />}
          </button>
        ))}
      </div>
    </>
  )
}

interface Choice {
  index: number
  label: string
  height: number
}

export function StreamStage({ mode = 'inline' }: { mode?: 'inline' | 'pip' | 'window' }): JSX.Element | null {
  const store = useStore()
  const watching = useChat((s) => s.watching)
  const minimized = useChat((s) => s.watchMinimized)
  const streams = useChat((s) => s.kickStreams)
  const buffers = useChat((s) => s.buffers)
  const video = useRef<HTMLVideoElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const hls = useRef<Hls | null>(null)
  /** The newest playback URL, for a player that has to begin again to reach without being rebuilt every time
   *  one arrives. */
  const latest = useRef('')
  const [room, setRoom] = useState({ width: 640, height: 260 })
  // How tall the picture is above the conversation, as it was left by dragging its bottom edge; none is the default
  // (nearly half the window, to a limit). Followed while dragging and remembered when it is let go.
  const [savedHeight, setSavedHeight] = usePref<number | null>('ui.streamHeight', null)
  const [liveHeight, setLiveHeight] = useState<number | null | undefined>(undefined)
  const inlineHeight = liveHeight === undefined ? savedHeight : liveHeight
  // Remembered between channels and between sessions: turning it down for one
  // stream and being deafened by the next is how a player loses a person.
  const [muted, setMuted] = usePref<boolean>('stream.muted', false)
  const [volume, setVolume] = usePref<number>('stream.volume', 1)
  /** Seconds left of an ad the stream is playing, or null when it is not playing one. */
  const [ad, setAd] = useState<number | null>(null)
  const adRanges = useRef<{ start: number; end: number }[]>([])
  /** What the stream offers, once its playlist has been read. */
  const [choices, setChoices] = useState<Choice[]>([])
  const [listed, setListed] = useState<CaptionTrack[]>([])
  /** Captions carried inside the video itself (CEA-608/708), which hls.js draws as text tracks of its own. */
  const [inVideo, setInVideo] = useState<CaptionTrack[]>([])
  const captions = [...listed, ...inVideo]
  /** What automatic choice is playing now, for the menu to say. */
  const [playing, setPlaying] = useState('')
  const [menu, setMenu] = useState<'quality' | 'captions' | null>(null)
  // Remembered between streams, apart for each service because their ladders differ: 0 is automatic, and an
  // empty language is captions off.
  const service = useChat((s) => s.accounts.find((a) => a.id === (watching?.accountId ?? ''))?.service)
  const [quality, setQuality] = usePref<number>(service === 'twitch' ? 'stream.quality.twitch' : 'stream.quality', 0)
  const [captionLanguage, setCaptionLanguage] = usePref<string>('stream.captions', '')

  const stream = watching ? streams[watching.bufferId] : undefined
  // The newest address rather than the one this began with: the signature in it expires, and the daemon asks for
  // a new one before it does. The player is not rebuilt for it - it is only where a player that has to start
  // over, after being refused, starts from.
  const url = stream?.playbackUrl ?? ''
  latest.current = url
  // A different picture is a different stream or a different broadcast; the same one with a new address is not.
  const picture = `${watching?.bufferId ?? ''}|${stream?.livestreamId ?? ''}`
  const hasUrl = url !== ''

  // The same measuring the call stage does, for the same reason: this is a
  // different shape in a narrow window, a full-screen one, and the corner.
  useEffect(() => {
    const el = frame.current
    if (!el) return
    // The window this is drawn in, which is not this one when popped out.
    const view = el.ownerDocument.defaultView ?? window
    const measure = (): void =>
      setRoom({
        width: el.clientWidth,
        height:
          mode === 'window'
            ? // Its own window: all of it.
              el.clientHeight
            : mode === 'pip'
              ? // The corner: as tall as its width makes the picture, so
                // resizing the panel resizes the picture.
                (el.clientWidth * 9) / 16
              : (inlineHeight ?? Math.min(view.innerHeight * 0.45, 460))
      })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    view.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      view.removeEventListener('resize', measure)
    }
  }, [mode, minimized, watching, inlineHeight])

  // The player itself, torn down and rebuilt only when the picture changes - not when the viewer count ticks over,
  // and not when the address is renewed, which it is every few minutes.
  useEffect(() => {
    const el = video.current
    if (!el || !hasUrl || minimized) return
    if (!Hls.isSupported()) {
      store.toast('error', 'This build cannot play a stream')
      return
    }
    const player = new Hls({
      // Kick's playlists, which list what is being made as well as what is made.
      loader: ivsLoader(2),
      abrController: ivsAbr(),
      // How far behind to play, in seconds: see LIVE_SYNC_SECONDS.
      liveSyncDuration: LIVE_SYNC_SECONDS,
      liveMaxLatencyDuration: LIVE_MAX_LATENCY_SECONDS,
      // Never fetch a rendition larger than the box it is drawn in, when the choice is automatic.
      capLevelToPlayerSize: true,
      // A stream that runs for hours must not keep them all.
      backBufferLength: 20
    })
    hls.current = player
    // For the harness that measures how far behind the broadcaster the picture runs; see scripts/watch-stream-stalls.mjs.
    if (window.moho.uiShots) (window as unknown as { __mohoHls: Hls }).__mohoHls = player
    player.attachMedia(el)
    player.loadSource(latest.current)

    player.on(Hls.Events.MANIFEST_PARSED, () => {
      setChoices(menuOrder(renditionsOf(player)))
      void el.play().catch(() => {
        /* A picture that will not start is not worth an error dialog. */
      })
    })
    player.on(Hls.Events.LEVEL_LOADED, (_e, data) => {
      // Behind by a segment and a half at the least: where they are 5 seconds long, 4 seconds is less than one.
      const longest = Math.max(0, ...data.details.fragments.map((f) => f.duration))
      const behind = Math.max(LIVE_SYNC_SECONDS, longest * 1.5)
      if (player.config.liveSyncDuration !== behind) {
        player.config.liveSyncDuration = behind
        player.config.liveMaxLatencyDuration = Math.max(LIVE_MAX_LATENCY_SECONDS, behind * 2.5)
      }
    })
    // Ads Twitch puts into a stream are marked in its playlist as date ranges of their own, with a start and a
    // length; which of them the picture is playing is worked out against where the playhead is (see below).
    player.on(Hls.Events.LEVEL_UPDATED, (_e, data) => {
      adRanges.current = Object.values(data.details.dateRanges)
        .filter((r) => r && r.class === 'twitch-stitched-ad')
        .map((r) => ({ start: r!.startDate.getTime(), end: r!.startDate.getTime() + (r!.duration ?? r!.plannedDuration ?? 0) * 1000 }))
    })
    player.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
      const level = player.levels[data.level]
      if (level) setPlaying(renditionLabel({ height: level.height, frameRate: Number(level.attrs?.['FRAME-RATE']) || undefined }))
    })
    player.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_e, data) => {
      setListed(data.subtitleTracks.map((t) => ({ id: t.id, name: t.name, lang: t.lang })))
    })

    player.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        // A refused segment is an expired token, not a dead stream: the daemon
        // renews the address before it expires, so the next one is already
        // here and this only has to begin from it. Reloading the source picks
        // up whichever one is current.
        if (latest.current) player.loadSource(latest.current)
        player.startLoad()
        return
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        player.recoverMediaError()
        return
      }
      store.toast('error', 'That stream stopped playing')
      store.stopWatching()
    })

    // Whether the playhead is inside an ad, and how long it has left, said once a second.
    const adTimer = setInterval(() => {
      const at = player.playingDate?.getTime()
      const inside = at === undefined ? undefined : adRanges.current.find((r) => at >= r.start && at < r.end)
      setAd(inside && at !== undefined ? Math.max(1, Math.ceil((inside.end - at) / 1000)) : null)
    }, 1000)

    return () => {
      clearInterval(adTimer)
      player.destroy()
      hls.current = null
      adRanges.current = []
      setAd(null)
      setChoices([])
      setListed([])
      setInVideo([])
      setPlaying('')
    }
  }, [hasUrl, picture, minimized, store])

  // Captions inside the picture. Twitch lists none in its playlist; a streamer whose encoder sends them
  // (none of the busiest channels sampled did) has them in the video, and hls.js turns them into text tracks.
  // Numbered from where the listed ones can never reach, so one choice means one track.
  useEffect(() => {
    const el = video.current
    if (!el || !hasUrl || minimized) return
    const scan = (): void => {
      const found: CaptionTrack[] = []
      for (let i = 0; i < el.textTracks.length; i++) {
        const t = el.textTracks[i]
        if (t.kind === 'captions') found.push({ id: IN_VIDEO + i, name: t.label || `Captions ${found.length + 1}`, lang: t.language || undefined })
      }
      setInVideo((was) => (JSON.stringify(was) === JSON.stringify(found) ? was : found))
    }
    scan()
    el.textTracks.addEventListener('addtrack', scan)
    el.textTracks.addEventListener('removetrack', scan)
    return () => {
      el.textTracks.removeEventListener('addtrack', scan)
      el.textTracks.removeEventListener('removetrack', scan)
    }
  }, [hasUrl, picture, minimized])

  // Twitch gives points for time spent watching and counts it from what the website's player reports once a minute,
  // which a player of our own does not send. Told to the daemon once a minute while this picture is really
  // playing and showing; a paused, hidden, minimised or closed stage says nothing, and the daemon sends nothing
  // for a channel that is not live (see backend/twitch/watch.rs).
  const [reportWatching] = usePref<boolean>('twitch.reportWatching', true)
  useEffect(() => {
    if (service !== 'twitch' || !watching || !hasUrl || minimized || !reportWatching) return
    const bufferId = watching.bufferId
    const timer = setInterval(() => {
      const el = video.current
      if (!el || el.paused || el.ended || el.readyState < 3 || document.visibilityState !== 'visible') return
      void window.moho.rpc('reportTwitchWatching', { bufferId }).catch(() => {
        /* Said nowhere: it is points, and the stream is playing either way. */
      })
    }, 60_000)
    return () => clearInterval(timer)
  }, [service, watching, hasUrl, picture, minimized, reportWatching])

  // The sound as it was left, whenever there is a picture to apply it to.
  useEffect(() => {
    const el = video.current
    if (!el) return
    el.muted = muted
    el.volume = Math.min(1, Math.max(0, volume))
  }, [muted, volume, hasUrl, picture, minimized])

  // Which rendition: automatic, or the height that was chosen when this stream offers it.
  useEffect(() => {
    const player = hls.current
    if (!player || choices.length === 0) return
    const wanted = quality > 0 ? renditionOf(renditionsOf(player), quality) : -1
    if (wanted >= 0) {
      player.autoLevelCapping = -1
      player.currentLevel = wanted
    } else {
      player.currentLevel = -1
      player.autoLevelCapping = autoCeiling(renditionsOf(player), AUTO_MAX_HEIGHT)
    }
  }, [quality, choices])

  // Which captions: none, or the language that was chosen when this stream has captions in it.
  useEffect(() => {
    const player = hls.current
    if (!player) return
    const track = captionTrack(captions, captionLanguage, navigator.language)
    const own = track >= IN_VIDEO
    player.subtitleDisplay = track >= 0 && !own
    player.subtitleTrack = own ? -1 : track
    // The ones inside the video are shown or hidden on the element itself.
    const el = video.current
    if (el) {
      for (let i = 0; i < el.textTracks.length; i++) {
        if (el.textTracks[i].kind === 'captions') el.textTracks[i].mode = track === IN_VIDEO + i ? 'showing' : 'disabled'
      }
    }
  }, [captionLanguage, listed, inVideo])

  // A stream that has ended is not a picture any more, and the surface should
  // not sit there showing the last frame of it.
  useEffect(() => {
    if (watching && stream && !stream.live) {
      store.toast('info', `${watching.title} has finished streaming`)
      store.stopWatching()
    }
  }, [watching, stream, store])

  if (!watching) return null

  const where = buffers.find((b) => b.id === watching.bufferId)?.name ?? ''
  const fit = fitTiles(1, room.width, room.height, Infinity)
  const captionsOn = captionTrack(captions, captionLanguage, navigator.language) >= 0
  const watchers = stream?.viewers
  const subtitle = `Live${watchers ? ` · ${watchers.toLocaleString()} watching` : ''}${
    where ? ` · ${bufferDisplayName(where)}` : ''
  }`

  return (
    <VideoStage
      mode={mode}
      title={stream?.title || watching.title}
      subtitle={subtitle}
      minimized={minimized}
      onMinimized={(m) => store.setWatchMinimized(m)}
      onGoTo={() => void store.selectBuffer(watching.bufferId)}
      onEnd={() => store.stopWatching()}
      endLabel="Stop watching"
      endIcon="stop_circle"
      onPopOut={mode === 'window' ? undefined : () => store.setStreamPoppedOut(true)}
      onBringBack={() => store.setStreamPoppedOut(false)}
      height={Math.round(room.height)}
      onHeight={(h, commit) => {
        setLiveHeight(commit ? undefined : h)
        if (commit) setSavedHeight(h)
      }}
      controls={
        <>
          <IconButton
            name={captionsOn ? 'closed_caption' : 'closed_caption_disabled'}
            title={captions.length === 0 ? 'No captions for this stream' : captionsOn ? 'Captions on' : 'Captions off'}
            className={captionsOn ? 'active' : undefined}
            disabled={captions.length === 0}
            onClick={() => {
              if (captions.length === 1) setCaptionLanguage(captionsOn ? '' : captions[0].lang || captions[0].name)
              else setMenu(menu === 'captions' ? null : 'captions')
            }}
          />
          <IconButton
            name="high_quality"
            title={quality > 0 ? `Resolution: ${quality}p` : 'Resolution: automatic'}
            disabled={choices.length === 0}
            onClick={() => setMenu(menu === 'quality' ? null : 'quality')}
          />
          <IconButton
            name={muted ? 'volume_off' : 'volume_up'}
            title={muted ? 'Unmute' : 'Mute'}
            className={muted ? 'calling' : undefined}
            onClick={() => setMuted(!muted)}
          />
          <input
            type="range"
            className="stream-volume"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            aria-label="Volume"
            title="Volume"
            onChange={(e) => {
              const next = Number(e.target.value)
              setVolume(next)
              setMuted(next === 0)
            }}
          />
        </>
      }
    >
      <div className={mode === 'window' ? 'video-stage in-window' : 'video-stage'} ref={frame}>
        <div className="video-tile" style={{ width: `${Math.floor(fit.tileWidth)}px` }}>
          <video ref={video} className="video-tile-picture" autoPlay playsInline />
          {ad !== null && (
            <div className="stream-ad small" role="status" title="Twitch plays ads in a stream for an account without Turbo or a subscription to the channel">
              <Icon name="campaign" size={14} />
              <span>Ad break · {ad} s</span>
            </div>
          )}
          {menu === 'quality' && (
            <StreamMenu
              title="Resolution"
              onClose={() => setMenu(null)}
              choices={[
                { label: 'Auto', detail: quality === 0 && playing ? playing : undefined, checked: quality === 0 || !choices.some((c) => c.height === quality), onClick: () => setQuality(0) },
                ...choices.map((c) => ({ label: c.label, checked: quality === c.height, onClick: () => setQuality(c.height) }))
              ]}
            />
          )}
          {menu === 'captions' && (
            <StreamMenu
              title="Captions"
              onClose={() => setMenu(null)}
              choices={[
                { label: 'Off', checked: !captionsOn, onClick: () => setCaptionLanguage('') },
                ...captions.map((t) => ({ label: t.name, checked: captionsOn && captionTrack(captions, captionLanguage, navigator.language) === t.id, onClick: () => setCaptionLanguage(t.lang || t.name) }))
              ]}
            />
          )}
        </div>
      </div>
    </VideoStage>
  )
}

/**
 * The stream being watched, in a window of its own while it is popped out.
 *
 * A child of this window, as a popped-out call is - see StageWindow - so the
 * player is this renderer's and nothing restarts but the picture. Closing the
 * window puts the stream back in moho rather than ending it.
 */
export function StreamWindowHost(): JSX.Element | null {
  const store = useStore()
  const poppedOut = useChat((s) => s.streamPoppedOut)
  const watching = useChat((s) => s.watching)
  if (!poppedOut || !watching) return null
  return (
    <StageWindow
      name={STREAM_WINDOW_NAME}
      title={`${watching.title} — moho`}
      size="width=960,height=600"
      onClosed={() => store.setStreamPoppedOut(false)}
    >
      <StreamStage mode="window" />
    </StageWindow>
  )
}
