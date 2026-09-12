import type { BufferEntry } from '../state/store'

/**
 * Telling the daemon which Kick channels are actually on screen.
 *
 * Kick counts watch time from an authenticated realtime subscription, and only
 * this side knows what is being looked at - the daemon holds every channel the
 * account follows and cannot tell which of them somebody is reading.
 *
 * Deliberately two things and no more: the conversation that is open, and a
 * channel whose video is playing, which includes the picture-in-picture window
 * because that is still watching. Not every followed channel - claiming to
 * watch twenty streams at once is untrue, and it is exactly the shape of thing
 * that gets an account looked at.
 */
export function watchedKickBuffers(
  buffers: BufferEntry[],
  activeBufferId: string,
  watchingBufferId: string | undefined,
  serviceOf: (bufferId: string) => string | undefined
): string[] {
  const wanted = new Set<string>()
  for (const id of [activeBufferId, watchingBufferId]) {
    if (!id) continue
    const buffer = buffers.find((b) => b.id === id)
    // Channels only. A whisper has no broadcast to be watching.
    if (buffer?.kind !== 'channel') continue
    if (serviceOf(id) !== 'kick') continue
    wanted.add(id)
  }
  return [...wanted]
}

/**
 * Says what changed, so the daemon is told once per change rather than on
 * every render.
 */
export function watchDelta(was: string[], now: string[]): { start: string[]; stop: string[] } {
  return {
    start: now.filter((id) => !was.includes(id)),
    stop: was.filter((id) => !now.includes(id))
  }
}
