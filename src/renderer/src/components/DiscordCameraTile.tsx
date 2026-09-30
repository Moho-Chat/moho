import { useEffect, useRef } from 'react'
import { useStore } from '../state/hooks'
import { watchCamera } from '../lib/discordwatch'

/**
 * One person's camera in a Discord call.
 *
 * A canvas for the same reason as the Go Live tile: frames arrive from the
 * daemon as encoded VP8 rather than as a MediaStream, and this window does the
 * decoding. Mounted only while the camera is on - the store drops the entry
 * when the daemon says it has gone off.
 */
export function DiscordCameraTile({
  accountId,
  userId,
  name
}: {
  accountId: string
  userId: string
  name: string
}): JSX.Element {
  const store = useStore()
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvas.current) return
    const watch = watchCamera(accountId, userId, canvas.current, (message) => store.toast('error', message))
    return () => watch.stop()
  }, [accountId, userId])

  return (
    <div className="discord-camera-tile">
      <canvas ref={canvas} className="discord-camera-canvas" />
      <span className="discord-camera-name small ellipsis">{name}</span>
    </div>
  )
}
