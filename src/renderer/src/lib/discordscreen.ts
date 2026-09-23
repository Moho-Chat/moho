/**
 * A screen, encoded here and sent to the daemon to put on the wire.
 *
 * The division is the one the Matrix calls already draw, from the other side.
 * There the browser holds the whole call, because WebRTC is the browser's.
 * Here the protocol is Discord's own - RTP in a shape no browser speaks, on a
 * socket the daemon owns - so the daemon holds the connection, and this holds
 * the part only a browser has: the encoders.
 *
 * VP8 rather than H.264. Chromium's VP8 encoder is software and present on
 * every machine; its H.264 one depends on the platform, and a screen share
 * that works on one desktop and not the next is worse than one that is a
 * little larger on the wire.
 */

/**
 * Chromium has this and TypeScript's DOM library does not.
 *
 * It is how a `MediaStreamTrack` is read frame by frame rather than drawn -
 * the alternative is a canvas in the middle, which copies every pixel of
 * every frame through the GPU for no reason.
 */
declare class MediaStreamTrackProcessor {
  constructor(init: { track: MediaStreamTrack })
  readonly readable: ReadableStream<VideoFrame>
}

/** What to aim for. Discord's own Go Live default for a free account. */
const WIDTH = 1280
const HEIGHT = 720
const FRAMERATE = 30
const BITRATE = 2_500_000

/**
 * How often to send a keyframe unasked.
 *
 * A viewer who arrives mid-stream sees nothing until one lands, and nothing
 * in this path can hear them asking - the daemon does not read the far end's
 * requests yet. Two seconds is the interval Discord's own client settles on,
 * and it is the difference between joining a stream and waiting at a black
 * rectangle for as long as the scene stays still.
 */
const KEYFRAME_EVERY_MS = 2000

export interface ScreenShare {
  stop: () => void
  /** The capture, so the window can show what is being sent. */
  stream: MediaStream
}

/**
 * Starts encoding a capture and handing frames to the daemon.
 *
 * `source` is a stream the caller already opened - the Electron desktop
 * picker's, so the same choice of window the Matrix path makes. Opening it
 * here would mean a second picker for the same question.
 */
export async function shareScreen(
  accountId: string,
  source: MediaStream,
  onError: (message: string) => void
): Promise<ScreenShare> {
  const track = source.getVideoTracks()[0]
  if (!track) throw new Error('that capture has no picture in it')

  const supported = await VideoEncoder.isConfigSupported({
    codec: 'vp8',
    width: WIDTH,
    height: HEIGHT,
    bitrate: BITRATE,
    framerate: FRAMERATE
  })
  if (!supported.supported) throw new Error('this machine has no VP8 encoder')

  let stopped = false
  const encoder = new VideoEncoder({
    output: (chunk) => {
      // Copied out of the chunk rather than kept: the chunk's buffer is the
      // encoder's and is reused the moment this returns.
      const bytes = new Uint8Array(chunk.byteLength)
      chunk.copyTo(bytes)
      void window.moho
        .rpc('sendDiscordVideoFrame', {
          accountId,
          frame: toBase64(bytes),
          timestampMicros: chunk.timestamp
        })
        // A dropped frame is not worth a toast - the next one is already on
        // its way, and a stream that complained once per lost packet would
        // fill the window with them.
        .catch(() => {})
    },
    error: (e) => {
      if (stopped) return
      onError(`The encoder stopped: ${e.message}`)
      stop()
    }
  })
  encoder.configure({
    codec: 'vp8',
    width: WIDTH,
    height: HEIGHT,
    bitrate: BITRATE,
    framerate: FRAMERATE,
    // Latency over quality, which is what a shared screen is for: somebody
    // is watching a pointer move.
    latencyMode: 'realtime'
  })

  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader()
  let lastKeyframe = 0

  const pump = async (): Promise<void> => {
    while (!stopped) {
      const { value, done } = await reader.read()
      if (done || !value) break
      // Dropped rather than queued when the encoder is behind. A queue that
      // grows is latency that never comes back, and on a shared screen a
      // late frame is worth less than the next one.
      if (encoder.encodeQueueSize > 2) {
        value.close()
        continue
      }
      const now = performance.now()
      const key = now - lastKeyframe > KEYFRAME_EVERY_MS
      if (key) lastKeyframe = now
      encoder.encode(value, { keyFrame: key })
      value.close()
    }
  }

  const stop = (): void => {
    if (stopped) return
    stopped = true
    void reader.cancel().catch(() => {})
    if (encoder.state !== 'closed') encoder.close()
    for (const t of source.getTracks()) t.stop()
  }

  // The browser's own "stop sharing" control has to reach the stream too, or
  // Discord keeps showing viewers a frozen last frame.
  track.onended = () => stop()

  void pump().catch((e: Error) => {
    if (!stopped) onError(`The capture stopped: ${e.message}`)
    stop()
  })

  return { stop, stream: source }
}

/**
 * Bytes as base64, in pieces.
 *
 * `String.fromCharCode(...bytes)` on a whole keyframe blows the argument
 * limit and throws - a keyframe is tens of kilobytes, and the limit is about
 * a hundred thousand arguments on a good day and fewer under memory
 * pressure.
 */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
