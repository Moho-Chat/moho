/**
 * Moving pictures that arrive from the daemon as encoded VP8: somebody's
 * camera in a Discord call, somebody's Go Live stream.
 *
 * One decoder per picture, for as long as the picture lasts, fed from the
 * store's event handler from the very first frame - and any number of canvases
 * drawing what it produces. The alternative, a decoder per canvas, went black
 * whenever a canvas was replaced: moving somebody from the grid to the stage,
 * or the whole call into a window of its own, makes a new canvas, and a new
 * decoder can only begin at a keyframe - which a camera may not send again
 * for a long time, since nothing here can ask it for one.
 *
 * The latest picture is kept, so a canvas that arrives late shows it at once.
 */

export interface FeedFrame {
  frame?: string
  keyframe?: boolean
  timestampMicros?: number
  ended?: boolean
}

interface Feed {
  decoder: VideoDecoder
  /** The latest picture, kept for canvases that subscribe later. */
  latest: HTMLCanvasElement
  canvases: Set<HTMLCanvasElement>
  /** Whether a keyframe has been given to the decoder since it (re)started. */
  started: boolean
}

const feeds = new Map<string, Feed>()

function draw(onto: HTMLCanvasElement, from: CanvasImageSource, width: number, height: number): void {
  if (onto.width !== width || onto.height !== height) {
    onto.width = width
    onto.height = height
  }
  onto.getContext('2d')?.drawImage(from, 0, 0)
}

function open(key: string): Feed {
  const latest = document.createElement('canvas')
  const feed: Feed = {
    latest,
    canvases: new Set(),
    started: false,
    decoder: new VideoDecoder({
      output: (frame) => {
        try {
          // Sized from the picture: the sender chooses the resolution, and a
          // canvas fixed at another size would resample every frame for
          // nothing.
          draw(latest, frame, frame.displayWidth, frame.displayHeight)
          for (const canvas of feed.canvases) draw(canvas, latest, latest.width, latest.height)
        } finally {
          // Always: a VideoFrame holds a GPU buffer, and leaking one per
          // frame exhausts the pool in seconds.
          frame.close()
        }
      },
      error: (e) => {
        console.warn(`[frames] ${key}: the decoder stopped: ${e.message}`)
        close(key)
      }
    })
  }
  // Codec only; the size comes from the keyframe.
  feed.decoder.configure({ codec: 'vp8', optimizeForLatency: true })
  feeds.set(key, feed)
  return feed
}

function close(key: string): void {
  const feed = feeds.get(key)
  if (!feed) return
  feeds.delete(key)
  try {
    if (feed.decoder.state !== 'closed') feed.decoder.close()
  } catch {
    /* already gone */
  }
  for (const canvas of feed.canvases) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
}

/** One frame for the picture named `key`. */
export function feedFrame(key: string, d: FeedFrame): void {
  if (d.ended) {
    close(key)
    return
  }
  if (!d.frame) return
  let feed = feeds.get(key)
  if (!feed) {
    // Only a keyframe can begin a picture.
    if (!d.keyframe) return
    feed = open(key)
  }
  if (!feed.started) {
    if (!d.keyframe) return
    feed.started = true
  }
  try {
    feed.decoder.decode(
      new EncodedVideoChunk({
        type: d.keyframe ? 'key' : 'delta',
        timestamp: d.timestampMicros ?? 0,
        data: fromBase64(d.frame)
      })
    )
  } catch (e) {
    // One bad frame is not the end of a picture; wait for the next keyframe.
    feed.started = false
    console.warn(`[frames] ${key}: a frame would not decode:`, (e as Error).message)
  }
}

/** Draws the picture named `key` into `canvas` until the returned function is called. */
export function showFeed(key: string, canvas: HTMLCanvasElement): () => void {
  const feed = feeds.get(key)
  if (feed && feed.latest.width > 0) draw(canvas, feed.latest, feed.latest.width, feed.latest.height)
  // Subscribed even before the picture exists: the first keyframe then draws
  // straight into it.
  let target = feed
  const attach = (): void => {
    target = feeds.get(key)
    target?.canvases.add(canvas)
  }
  attach()
  // A feed opened after this canvas subscribed - the camera came on while its
  // tile was already showing - is picked up on the next look.
  const timer = window.setInterval(() => {
    if (feeds.get(key) !== target) attach()
  }, 500)
  return () => {
    window.clearInterval(timer)
    for (const feed of feeds.values()) feed.canvases.delete(canvas)
  }
}

/** Every picture this account has open, for a call that has ended. */
export function closeFeeds(prefix: string): void {
  for (const key of [...feeds.keys()]) if (key.startsWith(prefix)) close(key)
}

export const cameraKey = (accountId: string, userId: string): string => `camera:${accountId}|${userId}`
export const streamKey = (accountId: string, key: string): string => `stream:${accountId}|${key}`

/**
 * Base64 back to bytes. The frames cross the RPC boundary as text because
 * that is what the event bus carries.
 */
function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}
