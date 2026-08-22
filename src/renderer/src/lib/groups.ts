import type { BufferGroup } from '../../../shared/wire'
import type { BufferEntry } from '../state/store'

/**
 * The rail entries worth drawing.
 *
 * An account entry is the home for buffers no backend grouped, which is how
 * IRC, Sneedchat and Matrix reach the rail at all. Discord never puts anything
 * there - every channel belongs to a guild and every DM to the DM entry - so
 * its account entry would be a tile that opens an empty pane.
 *
 * Emptiness alone is not enough to hide one: IRC and Sneedchat have no buffers
 * either until they finish connecting, and Sneedchat's Tor bootstrap makes
 * that several seconds. So an account with nothing anywhere yet keeps its
 * tile, and only one whose buffers all live elsewhere loses it.
 *
 * Shared by the rail and the channel pane deliberately - if they disagreed,
 * the selected group could be one with no tile, leaving a pane the user cannot
 * navigate away from.
 */
export function visibleGroups(groups: BufferGroup[], buffers: BufferEntry[]): BufferGroup[] {
  const inGroup = new Map<string, number>()
  const inAccount = new Map<string, number>()
  for (const b of buffers) {
    inAccount.set(b.accountId, (inAccount.get(b.accountId) ?? 0) + 1)
    if (b.groupId) inGroup.set(b.groupId, (inGroup.get(b.groupId) ?? 0) + 1)
  }
  return groups.filter((g) => {
    if (g.kind !== 'account') return true
    if ((inGroup.get(g.id) ?? 0) > 0) return true
    return (inAccount.get(g.accountId) ?? 0) === 0
  })
}
