/**
 * Puts a received H.264 frame into the order a hardware decoder can read.
 *
 * Some senders (seen from a Fluxer screen share) build their keyframes as the
 * IDR slice first and the SPS and PPS after it, send the parameter sets once
 * more in a frame of their own, and pad frames to their bitrate with filler
 * NAL units - 186 KB of filler in a 190 KB frame. ffmpeg, and so Chromium's
 * software decoder, shrugs all of that off. Chromium's VA-API path reads the
 * units in order, meets a slice whose parameter sets do not exist yet, and
 * never decodes a single frame: the call shows a black tile while the video
 * arrives in full. Disabling hardware decoding "fixes" it; this keeps the GPU.
 *
 * What is done, per frame (Annex B, as WebRTC hands frames to a transform):
 *  - SPS and PPS move in front of everything else;
 *  - filler data (type 12) is dropped - it carries nothing;
 *  - a frame of parameter sets alone is remembered and held back, since a
 *    decoder handed it as a delta frame before any keyframe drops it;
 *  - an IDR frame without parameter sets gets the remembered ones in front.
 * A frame that already reads well comes back as the same array, untouched.
 */

/** The NAL unit types this cares about. */
export const Nal = { Slice: 1, Idr: 5, Sps: 7, Pps: 8, Filler: 12 } as const

interface Unit {
  /** Where the start code begins. */
  at: number
  /** Where the next unit's start code begins (or the frame ends). */
  end: number
  type: number
}

/** The NAL units of an Annex B frame, start codes included. */
export function units(b: Uint8Array): Unit[] {
  const starts: number[] = []
  const heads: number[] = []
  let i = 0
  while (i + 3 <= b.length) {
    if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1) {
      starts.push(i)
      heads.push(i + 3)
      i += 3
    } else if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 0 && i + 3 < b.length && b[i + 3] === 1) {
      starts.push(i)
      heads.push(i + 4)
      i += 4
    } else {
      i++
    }
  }
  return starts.map((at, k) => ({
    at,
    end: k + 1 < starts.length ? starts[k + 1] : b.length,
    type: heads[k] < b.length ? b[heads[k]] & 0x1f : 0
  }))
}

/** The parameter sets last seen on one stream, carried from frame to frame. */
export interface TidyState {
  sps: Uint8Array | null
  pps: Uint8Array | null
}

export function newTidyState(): TidyState {
  return { sps: null, pps: null }
}

/**
 * The frame as it should go to the decoder: the same array when nothing needs
 * changing, a new one when something did, or null when it should not be
 * passed on at all (parameter sets alone, now remembered).
 */
export function tidyH264(b: Uint8Array, state: TidyState): Uint8Array | null {
  const list = units(b)
  if (list.length === 0) return b
  for (const u of list) {
    if (u.type === Nal.Sps) state.sps = b.slice(u.at, u.end)
    else if (u.type === Nal.Pps) state.pps = b.slice(u.at, u.end)
  }
  const slices = list.filter((u) => u.type >= Nal.Slice && u.type <= Nal.Idr)
  if (slices.length === 0) {
    // Parameter sets (and perhaps filler) with no picture: kept for the next
    // keyframe. Anything else without a slice (SEI alone, say) passes as is.
    return list.every((u) => u.type === Nal.Sps || u.type === Nal.Pps || u.type === Nal.Filler) ? null : b
  }

  const params = list.filter((u) => u.type === Nal.Sps || u.type === Nal.Pps)
  const rest = list.filter((u) => u.type !== Nal.Sps && u.type !== Nal.Pps && u.type !== Nal.Filler)
  const idr = slices.some((u) => u.type === Nal.Idr)
  const lend = idr && !params.some((u) => u.type === Nal.Sps) && state.sps !== null && state.pps !== null
  const hasFiller = list.length !== params.length + rest.length
  const late = params.length > 0 && list.indexOf(params[0]) > list.indexOf(rest[0])
  if (!lend && !hasFiller && !late) return b

  const parts: Uint8Array[] = lend
    ? [state.sps!, state.pps!, ...rest.map((u) => b.subarray(u.at, u.end))]
    : [...params, ...rest].map((u) => b.subarray(u.at, u.end))
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
