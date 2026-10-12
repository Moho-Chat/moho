import type { Activity, Member } from '../../../shared/wire'
import type { BufferEntry } from '../state/store'

/** The picture before the line: a gamepad for a game, a note for a track, none for words. */
export function activityIcon(activity: Activity): string | undefined {
  return activity.kind === 'game' ? 'sports_esports' : activity.kind === 'music' ? 'music_note' : undefined
}

/** The same thing as a sentence, for a tooltip or a header where there is no picture. */
export function activityLabel(activity: Activity): string {
  return activity.kind === 'game' ? `Playing ${activity.text}` : activity.kind === 'music' ? `Listening to ${activity.text}` : activity.text
}

/**
 * What the one person in a direct message is doing, where the service says.
 * Nothing for a room, and nothing for a list of several: it is one person's.
 */
export function dmActivity(buffer: BufferEntry, presence: Record<string, Member[]>): Activity | undefined {
  if (buffer.kind !== 'dm') return undefined
  const own = presence[buffer.id]
  return (own?.length === 1 && own[0].activity) || undefined
}
