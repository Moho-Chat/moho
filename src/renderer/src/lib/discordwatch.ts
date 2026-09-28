import type { NobilisEvent } from '../../../shared/wire'

/**
 * Somebody else's Go Live stream, decoded and drawn.
 *
 * The mirror of `discordscreen.ts`. That one takes frames off a capture,
 * encodes them and hands them to the daemon; this one takes frames from the
 * daemon, decodes them and draws them. Both live here rather than in the
 * daemon for the same reason: Chromium has the codecs and the daemon has
 * none, so the process with a window in it is the one that can do this at all.
 *
 * VP8 only, because that is what the sending side agreed with Discord and
 * what every machine can decode in software - a stream that plays on one
 * desktop and not the next is worse than one that is a little larger on the
 * wire.
 */

export interface StreamWatch {
  /** Stops decoding and releases the decoder. Safe to call twice. */
  stop: () => void
  /** Where the picture is drawn. Sized to the stream once one arrives. */
  canvas: HTMLCanvasElement
}

/**
 * Starts decoding a stream into a canvas.
 *
 * Nothing is asked of the daemon here - the caller has already asked to
 * watch, and frames arrive as events whether or not anything is drawing them.
 * This subscribes, decodes and draws until stopped.
 */
export function watchStream(
  accountId: string,
  streamKey: string,
  canvas: HTMLCanvasElement,
  onError: (message: string) => void
): StreamWatch {
  const context = canvas.getContext('2d')
  let stopped = false
  /**
   * Whether the decoder has been given a keyframe yet.
   *
   * The daemon drops everything before the first one, so in practice the
   * first frame to arrive is a keyframe - but a decoder configured and then
   * fed a delta frame throws rather than waits, and a stream that recovers by
   * itself after a hiccup is worth more than one that needs reopening.
   */
  let started = false

  const decoder = new VideoDecoder({
    output: (frame) => {
      try {
        if (stopped) return
        // Sized from the picture rather than from the layout: the sender
        // chooses the resolution and a canvas fixed at some other size would
        // resample every frame for nothing.
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth
          canvas.height = frame.displayHeight
        }
        context?.drawImage(frame, 0, 0)
      } finally {
        // Always, and before anything else can throw: a VideoFrame holds a
        // GPU buffer, and leaking one per frame exhausts the pool in seconds
        // and stops the stream with an error about nothing.
        frame.close()
      }
    },
    error: (e) => {
      if (stopped) return
      onError(`The decoder stopped: ${e.message}`)
      stop()
    }
  })

  // Codec only. Width and height come from the stream's own keyframe, so
  // nothing here has to be told them in advance or kept in step with the
  // sender when they change.
  decoder.configure({ codec: 'vp8', optimizeForLatency: true })

  const unsubscribe = window.moho.onEvent((event: NobilisEvent) => {
    if (stopped || event.event !== 'discordStreamFrame') return
    const d = event.data as {
      accountId?: string
      streamKey?: string
      frame?: string
      keyframe?: boolean
      timestampMicros?: number
      ended?: boolean
    }
    if (d.accountId !== accountId || d.streamKey !== streamKey) return
    if (d.ended) {
      stop()
      return
    }
    if (!d.frame) return
    if (!started) {
      if (!d.keyframe) return
      started = true
    }
    try {
      decoder.decode(
        new EncodedVideoChunk({
          type: d.keyframe ? 'key' : 'delta',
          timestamp: d.timestampMicros ?? 0,
          data: fromBase64(d.frame)
        })
      )
    } catch (e) {
      // One bad frame is not the end of a stream. The next keyframe is
      // seconds away at most, and a decoder that gave up on the first
      // undecodable chunk would show a black rectangle for the rest of the
      // call.
      started = false
      console.warn('[discord stream] a frame would not decode:', (e as Error).message)
    }
  })

  function stop(): void {
    if (stopped) return
    stopped = true
    unsubscribe()
    // `close` on an already-closed decoder throws, and this is reached both
    // from the error path and from the caller.
    try {
      if (decoder.state !== 'closed') decoder.close()
    } catch {
      /* already gone */
    }
  }

  return { stop, canvas }
}

/**
 * Base64 back to bytes.
 *
 * The frames cross the RPC boundary as text because that is what the event
 * bus carries. `atob` is the only decoder available in a renderer, and it
 * produces a string of char codes rather than bytes - so this is the
 * conversion, done once per frame rather than per byte where it can be.
 */
function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}
