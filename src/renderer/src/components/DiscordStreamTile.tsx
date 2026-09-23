import { useEffect, useRef } from 'react'
import { IconButton } from './Icon'
import { useChat, useStore } from '../state/hooks'
import { watchStream } from '../lib/discordwatch'

/**
 * Somebody else's shared screen, drawn in the call.
 *
 * A canvas rather than a `<video>`: the frames arrive as encoded VP8 from the
 * daemon rather than as a `MediaStream`, so there is nothing to put on
 * `srcObject` and the decoding is this window's job. `discordwatch.ts` does
 * that; this owns the canvas it draws into and the lifetime of the decoder.
 *
 * Shown only while something is being watched - one at a time, because there
 * is one place to draw a picture.
 */
export function DiscordStreamTile(): JSX.Element | null {
  const store = useStore()
  const watching = useChat((s) => s.discordWatching)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!watching || !canvas.current) return
    const watch = watchStream(watching.accountId, watching.streamKey, canvas.current, (message) =>
      store.toast('error', message)
    )
    // Stopped on the way out, and on any change of stream: a decoder left
    // running would keep drawing the old picture into the new tile.
    return () => watch.stop()
  }, [watching?.accountId, watching?.streamKey])

  if (!watching) return null

  return (
    <div className="discord-stream-tile">
      <div className="discord-stream-bar">
        <span className="small ellipsis">{watching.nick}&rsquo;s screen</span>
        <IconButton
          name="close"
          size={16}
          title="Stop watching"
          onClick={() => void store.stopWatchingDiscordStream()}
        />
      </div>
      {/* Nothing is drawn until the first keyframe arrives, which is up to two
          seconds after the connection opens - so the canvas starts behind a
          line saying so rather than as an unexplained black rectangle. */}
      <canvas ref={canvas} className="discord-stream-canvas" />
    </div>
  )
}
