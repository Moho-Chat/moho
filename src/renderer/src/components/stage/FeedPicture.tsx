import { useEffect, useRef } from 'react'
import { showFeed } from '../../lib/framefeed'

/**
 * A camera or a shared screen from Discord, drawn from its feed (see
 * framefeed.ts). Any number of these can show one feed at once, in either
 * window, without starting a decoder of their own.
 */
export function FeedPicture({ feedKey }: { feedKey: string }): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!canvas.current) return
    return showFeed(feedKey, canvas.current)
  }, [feedKey])
  return <canvas ref={canvas} className="stage-picture" />
}
