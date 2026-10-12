import type { Activity, Member, Profile } from '../../../shared/wire'
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

/**
 * What somebody is doing, for the profile card.
 *
 * What the service said in the lookup itself, and otherwise what their
 * presence already says wherever they are listed: the member lists carry it
 * for every service, so a card opened from a message needs no second question
 * to know the game somebody is in.
 */
export function profileActivity(
  profile: Pick<Profile, 'activity' | 'accountId' | 'id' | 'name' | 'handle'>,
  presence: Record<string, Member[]>,
  buffers: BufferEntry[]
): Activity | undefined {
  if (profile.activity) return profile.activity
  const names = [profile.name, profile.handle].filter((n): n is string => !!n).map((n) => n.toLowerCase())
  for (const buffer of buffers) {
    if (buffer.accountId !== profile.accountId) continue
    const found = presence[buffer.id]?.find(
      (m) => m.activity && ((profile.id && m.userId === profile.id) || names.includes(m.nick.toLowerCase()))
    )
    if (found?.activity) return found.activity
  }
  return undefined
}
