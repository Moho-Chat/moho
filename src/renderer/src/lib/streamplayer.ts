/**
 * The choices a stream's player offers - which rendition, which captions - kept apart from the player so
 * that what they mean can be said and tested without one.
 */

/** A rendition as the playlist describes it. */
export interface Rendition {
  height: number
  frameRate?: number
  bitrate?: number
}

/** "720p", and "720p60" for one that moves at 60 frames a second, as Kick's own player calls them. */
export function renditionLabel(r: Rendition): string {
  // A rendition with no picture is the one Twitch offers for listening: its playlist has no height.
  if (r.height <= 0) return 'Audio only'
  const fps = r.frameRate && r.frameRate > 30 ? Math.round(r.frameRate) : 0
  return `${r.height}p${fps || ''}`
}

/**
 * The highest rendition that automatic choice may pick: the tallest that is no taller than `ceiling`, or
 * the shortest there is when all are taller, since a ceiling below everything would leave nothing to play.
 * -1 for no ceiling at all.
 */
export function autoCeiling(renditions: Rendition[], ceiling: number): number {
  if (renditions.length === 0 || ceiling <= 0) return -1
  let best = -1
  // The shortest picture there is: audio only is not one, and automatic choice never settles on it.
  let lowest = Math.max(0, renditions.findIndex((r) => r.height > 0))
  renditions.forEach((r, i) => {
    if (r.height <= 0) return
    if (r.height < renditions[lowest].height) lowest = i
    if (r.height <= ceiling && (best < 0 || r.height > renditions[best].height || (r.height === renditions[best].height && (r.bitrate ?? 0) > (renditions[best].bitrate ?? 0)))) best = i
  })
  return best >= 0 ? best : lowest
}

/** The rendition of a wanted height: the one with the most bits if there are two, -1 if there is none. */
export function renditionOf(renditions: Rendition[], height: number): number {
  let found = -1
  renditions.forEach((r, i) => {
    if (r.height === height && (found < 0 || (r.bitrate ?? 0) > (renditions[found].bitrate ?? 0))) found = i
  })
  return found
}

/** The renditions as a menu lists them, tallest first, with each one's place in the player's own list. */
export function menuOrder(renditions: Rendition[]): { index: number; label: string; height: number }[] {
  const seen = new Set<number>()
  return renditions
    .map((r, index) => ({ index, label: renditionLabel(r), height: r.height, bitrate: r.bitrate ?? 0 }))
    .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate)
    // Two of one height are one choice.
    .filter((r) => (seen.has(r.height) ? false : (seen.add(r.height), true)))
    .map(({ index, label, height }) => ({ index, label, height }))
}

/** A caption track as the master playlist lists it. */
export interface CaptionTrack {
  id: number
  name: string
  lang?: string
}

/**
 * Which caption track a remembered choice means: its language where there is one, the first track when
 * what was chosen is not offered here, and none when captions are off.
 */
export function captionTrack(tracks: CaptionTrack[], wanted: string, language = ''): number {
  if (!wanted || tracks.length === 0) return -1
  const same = (lang: string): number => tracks.findIndex((t) => (t.lang ?? '').toLowerCase().split('-')[0] === lang.toLowerCase().split('-')[0])
  const chosen = same(wanted)
  if (chosen >= 0) return tracks[chosen].id
  // On, but in a language this stream has none of: the person's own language if it is there, else the first.
  const own = language ? same(language) : -1
  return tracks[own >= 0 ? own : 0].id
}
