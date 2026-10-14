import Hls from 'hls.js'

/**
 * Amazon IVS's low-latency playlists, which Kick's streams are, list what is already complete and then
 * what is being made: `#EXT-X-PREFETCH:<address>`, one per segment of the next few seconds. The address
 * answers as soon as it is asked and sends the segment as it is produced, so asking early is the way to
 * be seconds nearer the broadcaster. IVS's own player does that. hls.js does not know the tag and
 * leaves it out, which is why a stream played with it runs several seconds behind one played with
 * IVS's.
 *
 * Here each of those lines becomes a segment of the playlist like any other, the same length as the
 * last complete one, so hls.js asks for it and plays it as it arrives.
 *
 * Twitch's playlists do the same under another name - `#EXT-X-TWITCH-PREFETCH` - with two-second segments,
 * and are read the same way. They have none while an ad is playing (the ad's segments are not prefetched),
 * which needs nothing: a playlist with no such line is left as it is.
 */
/**
 * The addresses that were listed as prefetch, which hls.js must not judge the connection by: one of
 * them is sent as it is made, so it takes as long to arrive as it takes to broadcast (two seconds of
 * picture in two seconds), and bandwidth worked out from that is the stream's own bitrate. Taken for
 * the connection's, it moved the picture down a rendition at every other segment.
 */
const ahead = new Set<string>()

function remember(address: string): void {
  ahead.add(address)
  // Only the last few matter; a stream that runs for hours must not grow this for ever.
  if (ahead.size > 64) ahead.delete(ahead.values().next().value as string)
}

/** How far apart, in seconds, the longest and shortest segment may be for the next to be taken as their length. */
const UNIFORM_WITHIN = 0.25

export function withPrefetch(playlist: string, take = 2): string {
  if (take <= 0 || !/#EXT-X-(?:TWITCH-)?PREFETCH:/.test(playlist) || playlist.includes('#EXT-X-ENDLIST')) return playlist
  const lines = playlist.split('\n')
  const kept: string[] = []
  const ahead_: string[] = []
  let length = ''
  const lengths: number[] = []
  for (const line of lines) {
    const prefetch = /^#EXT-X-(?:TWITCH-)?PREFETCH:(\S+)/.exec(line.trim())
    if (prefetch) {
      ahead_.push(prefetch[1])
      continue
    }
    const segment = /^#EXTINF:([0-9.]+)/.exec(line)
    if (segment) {
      length = segment[1]
      lengths.push(Number(segment[1]))
    }
    kept.push(line)
  }
  // Nothing to say how long they are if no segment is complete yet.
  if (!length || ahead_.length === 0) return playlist
  // How long a segment still being made will turn out to be is a guess from the ones before it, and only a
  // good one where they are all alike. A broadcaster that is not re-encoded by IVS (one that sends its own
  // segments) has them of 3 to 5 seconds, and a guess of 3 for a segment of 5 leaves a gap the picture then
  // stops in, every few seconds.
  if (Math.max(...lengths) - Math.min(...lengths) > UNIFORM_WITHIN) return playlist
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop()
  for (const address of ahead_.slice(0, take)) {
    remember(address)
    kept.push(`#EXTINF:${length},prefetch`, address)
  }
  return `${kept.join('\n')}\n`
}

/**
 * hls.js's own judge of the connection, told to leave the prefetch segments out of it. See `ahead`.
 */
export function ivsAbr(): typeof Hls.DefaultConfig.abrController {
  const Base = Hls.DefaultConfig.abrController as unknown as new (hls: unknown) => Record<string, unknown>
  class Abr extends Base {
    // Private in hls.js's types and called by each of its three handlers that measure a segment.
    ignoreFragment(frag: { url?: string }): boolean {
      const parent = (Base.prototype as { ignoreFragment?: (f: unknown) => boolean }).ignoreFragment
      return ahead.has(frag.url ?? '') || (parent ? parent.call(this, frag) : false)
    }
  }
  return Abr as unknown as typeof Hls.DefaultConfig.abrController
}

/**
 * hls.js's own loader, with the playlist of a rendition read through `withPrefetch`. Everything else it
 * loads - the master playlist, the segments, the captions - is as it was.
 */
export function ivsLoader(take = 2): typeof Hls.DefaultConfig.loader {
  const Base = Hls.DefaultConfig.loader as unknown as new (config: unknown) => {
    load(context: Record<string, unknown>, config: unknown, callbacks: Record<string, (...args: unknown[]) => void>): void
  }
  class Loader extends Base {
    load(context: Record<string, unknown>, config: unknown, callbacks: Record<string, (...args: unknown[]) => void>): void {
      if (context.type !== 'level') return super.load(context, config, callbacks)
      super.load(context, config, {
        ...callbacks,
        onSuccess: (response, stats, ctx, details) => {
          const r = response as { data?: unknown }
          if (typeof r.data === 'string') response = { ...r, data: withPrefetch(r.data, take) }
          callbacks.onSuccess(response, stats, ctx, details)
        }
      })
    }
  }
  return Loader as unknown as typeof Hls.DefaultConfig.loader
}
