import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { IconButton } from './Icon'
import { VideoStage } from './VideoStage'
import { fitTiles } from './CallStage'
import { useChat, useStore } from '../state/hooks'
import { bufferDisplayName } from '../lib/util'

/**
 * A Kick channel's stream, in the surface a call uses.
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

/** The rendition ceiling. See the comment where it is used. */
const MAX_HEIGHT = 720

export function StreamStage({ mode = 'inline' }: { mode?: 'inline' | 'pip' }): JSX.Element | null {
  const store = useStore()
  const watching = useChat((s) => s.watching)
  const minimized = useChat((s) => s.watchMinimized)
  const streams = useChat((s) => s.kickStreams)
  const buffers = useChat((s) => s.buffers)
  const video = useRef<HTMLVideoElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const hls = useRef<Hls | null>(null)
  /** The newest playback URL, for the error path to reach without being
   *  rebuilt every time one arrives. */
  const latest = useRef('')
  const [room, setRoom] = useState({ width: 640, height: 260 })
  const [muted, setMuted] = useState(false)

  const stream = watching ? streams[watching.bufferId] : undefined
  // The current one rather than the one this started with: the signature in a
  // playback URL expires, and the refresh already running is what replaces it.
  const url = stream?.playbackUrl ?? ''
  latest.current = url

  // The same measuring the call stage does, for the same reason: this is a
  // different shape in a narrow window, a full-screen one, and the corner.
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const measure = (): void =>
      setRoom({
        width: el.clientWidth,
        height: Math.min(window.innerHeight * (mode === 'pip' ? 0.3 : 0.45), mode === 'pip' ? 260 : 460)
      })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [mode, minimized, watching])

  // The player itself, torn down and rebuilt only when the picture changes -
  // not when the viewer count ticks over, which it does every minute.
  useEffect(() => {
    const el = video.current
    if (!el || !url || minimized) return
    if (!Hls.isSupported()) {
      store.toast('error', 'This build cannot play a stream')
      return
    }
    const player = new Hls({
      // Enough buffer to ride out a hiccup, not so much that "live" means two
      // minutes ago: this is a chat window beside the stream, and people talk
      // about what just happened.
      liveSyncDurationCount: 3,
      // Never fetch a rendition larger than the box it is drawn in.
      capLevelToPlayerSize: true
    })
    hls.current = player
    player.attachMedia(el)
    player.loadSource(url)

    player.on(Hls.Events.MANIFEST_PARSED, () => {
      // 1080p60 is 5.8 Mbps and a real amount of CPU to decode beside a chat
      // client, and the ladder below it is cheaper for a picture this size.
      // A ceiling rather than a fixed choice: the bitrate ladder underneath
      // still adapts to the connection.
      const ceiling = player.levels.reduce(
        (best, level, i) => (level.height <= MAX_HEIGHT && level.height >= (player.levels[best]?.height ?? 0) ? i : best),
        -1
      )
      if (ceiling >= 0) player.autoLevelCapping = ceiling
      void el.play().catch(() => {
        /* A picture that will not start is not worth an error dialog. */
      })
    })

    player.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        // A refused segment is an expired token, not a dead stream: the
        // daemon re-asks Kick about the channel every minute, so the next
        // playback URL is already on its way and this only has to wait for
        // it. Reloading the source picks up whichever one is current.
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

    return () => {
      player.destroy()
      hls.current = null
    }
  }, [url, minimized, store, watching?.bufferId])

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
      controls={
        <IconButton
          name={muted ? 'volume_off' : 'volume_up'}
          title={muted ? 'Unmute' : 'Mute'}
          className={muted ? 'calling' : undefined}
          onClick={() => {
            const next = !muted
            setMuted(next)
            if (video.current) video.current.muted = next
          }}
        />
      }
    >
      <div className="video-stage" ref={frame}>
        <div className="video-tile" style={{ width: `${Math.floor(fit.tileWidth)}px` }}>
          <video ref={video} className="video-tile-picture" autoPlay playsInline />
        </div>
      </div>
    </VideoStage>
  )
}
