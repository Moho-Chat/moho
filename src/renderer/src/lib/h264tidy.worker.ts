/**
 * Where a call's encoded media passes on its way between the network and the
 * codecs (see SfuCall's `route`): somebody's H.264 video is put through
 * `tidyH264` (h264tidy.ts says why), and everything else - audio, other
 * codecs, this end's own sending - goes straight through.
 *
 * Every sender and receiver of a call with encoded streams turned on has to
 * come through here, because the browser holds their frames until somebody
 * takes them. Each gets its own pipe, and each video receiver its own
 * remembered parameter sets.
 */

import { newTidyState, tidyH264 } from './h264tidy'

interface EncodedFrame {
  data: ArrayBuffer
  getMetadata(): { mimeType?: string }
}

interface Route {
  readable: ReadableStream<EncodedFrame>
  writable: WritableStream<EncodedFrame>
  /** Somebody else's video, which may be H.264 that needs tidying. */
  video: boolean
}

self.onmessage = (event: MessageEvent<Route>): void => {
  const { readable, writable, video } = event.data
  if (!video) {
    readable.pipeTo(writable).catch(() => {})
    return
  }
  const state = newTidyState()
  readable
    .pipeThrough(
      new TransformStream<EncodedFrame, EncodedFrame>({
        transform(frame, out) {
          // Only what is known to be H.264: a start code can turn up by chance
          // inside a VP8 or VP9 frame, and rearranging that would ruin it.
          if (!/h264/i.test(frame.getMetadata().mimeType ?? '')) {
            out.enqueue(frame)
            return
          }
          const before = new Uint8Array(frame.data)
          const after = tidyH264(before, state)
          if (after === null) return
          if (after !== before) frame.data = after.buffer as ArrayBuffer
          out.enqueue(frame)
        }
      })
    )
    .pipeTo(writable)
    .catch(() => {})
}
