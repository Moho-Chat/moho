/**
 * A screen or a camera, encoded here and sent to the daemon to put on the
 * wire.
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

/**
 * What a picture is sent at. The height is a ceiling, not a size: the width
 * follows from the capture's own shape, so a tall window or an ultrawide
 * screen is scaled once, in proportion, rather than squeezed into 16:9.
 */
export interface VideoQuality {
  /** The tallest it may be, or `source` for the capture's own height. */
  height: number | 'source'
  framerate: number
}

/** Discord's own default, and the ceiling without Nitro. */
export const DEFAULT_QUALITY: VideoQuality = { height: 720, framerate: 30 }

/** What the encoder is configured with, worked out from the capture. */
export interface EncodeSettings {
  width: number
  height: number
  framerate: number
  bitrate: number
}

/** No picture is ever sent larger than this, whatever the source. */
const LARGEST_HEIGHT = 2160

/**
 * The size, rate and bitrate to encode a capture at.
 *
 * Even dimensions, because VP8 works in 16-pixel blocks and an odd one is
 * refused by some encoders. The bitrate is about 0.09 bits a pixel a frame,
 * which is what puts 720p30 at Discord's 2.5 Mbit, kept between half a
 * megabit - below which text is mush - and eight.
 */
export function encodeSettings(
  capture: { width?: number; height?: number },
  quality: VideoQuality
): EncodeSettings {
  const sourceWidth = capture.width || 1280
  const sourceHeight = capture.height || 720
  const ceiling = Math.min(quality.height === 'source' ? sourceHeight : quality.height, LARGEST_HEIGHT)
  // Never scaled up: sending a 600-pixel window as 1080p costs bandwidth and
  // adds nothing.
  const height = Math.min(sourceHeight, ceiling)
  const width = Math.round((sourceWidth * height) / sourceHeight)
  const even = (n: number): number => Math.max(16, n - (n % 2))
  const settings = { width: even(width), height: even(height), framerate: quality.framerate }
  const bitrate = Math.round(settings.width * settings.height * settings.framerate * 0.09)
  return { ...settings, bitrate: Math.min(8_000_000, Math.max(500_000, bitrate)) }
}

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
  settings: EncodeSettings,
  onError: (message: string) => void
): Promise<ScreenShare> {
  return sendVideo(accountId, 'screen', source, settings, onError)
}

/**
 * Starts encoding a camera for the call this account is in.
 *
 * The same encoder as a screen: VP8 in software, keyframes on a clock. What
 * differs is only where the daemon puts the frames - on the voice
 * connection's camera SSRC rather than on a stream connection of its own.
 */
export async function sendCamera(
  accountId: string,
  source: MediaStream,
  settings: EncodeSettings,
  onError: (message: string) => void
): Promise<ScreenShare> {
  return sendVideo(accountId, 'camera', source, settings, onError)
}

async function sendVideo(
  accountId: string,
  kind: 'screen' | 'camera',
  source: MediaStream,
  settings: EncodeSettings,
  onError: (message: string) => void
): Promise<ScreenShare> {
  const track = source.getVideoTracks()[0]
  if (!track) throw new Error('that capture has no picture in it')
  const { width, height, framerate, bitrate } = settings

  const supported = await VideoEncoder.isConfigSupported({
    codec: 'vp8',
    width,
    height,
    bitrate,
    framerate
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
          kind,
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
    width,
    height,
    bitrate,
    framerate,
    // Latency over quality, which is what a shared screen is for: somebody
    // is watching a pointer move.
    latencyMode: 'realtime'
  })

  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader()
  let lastKeyframe = 0
  let lastFrame = 0
  const spacing = 1000 / framerate

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
      // Held to the rate chosen. A screen captures at whatever the display
      // runs at, and 60 frames encoded for a 30 frame stream is twice the
      // bandwidth for a picture nobody sees move faster. A little slack, so
      // a capture running exactly at the rate is not halved by jitter.
      if (now - lastFrame < spacing * 0.85) {
        value.close()
        continue
      }
      lastFrame = now
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
