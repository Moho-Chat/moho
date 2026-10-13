import type { Account } from '../../../shared/wire'
import type { BufferEntry } from '../state/store'
import type { CustomCategory } from './categories'
import { dmCategoryId } from './dmcategories'

/**
 * Steam's friend folders, and the headings on the direct-messages page that start from them.
 *
 * A Steam account keeps folders for its friends - "Raiders", "Work" - and a friend can be in
 * several. The direct-messages page has headings that a person makes, renames, fills by dragging
 * and deletes, and those are this window's own: nothing done to them is done on Steam, and nothing
 * Steam does reaches them. The folders are mirrored both ways only on the Steam account's own page,
 * where they are the page's headings and not copies of anything.
 *
 * What this does is start the direct-messages page from them, once: the first time an account's
 * folders are heard, if it has any, there is a heading for each, and each friend's conversation is
 * under the folder they are in. After that the headings are the person's, so a folder made on Steam
 * later is not made here, one deleted here is not made again, and none of it is sent to Steam.
 */

export interface SteamGroup {
  id: number
  name: string
  /** Friends in it, by 64-bit id as text. */
  members: string[]
}

const PREFIX = 'sg:'

/** The heading that stands for one of an account's groups. Stable across renames. */
export function steamCategoryId(accountId: string, groupId: number): string {
  return `${PREFIX}${accountId}:${groupId}`
}

/** Which account and group a heading stands for, if it stands for one. */
export function parseSteamCategory(id: string): { accountId: string; groupId: number } | null {
  if (!id.startsWith(PREFIX)) return null
  const rest = id.slice(PREFIX.length)
  const colon = rest.lastIndexOf(':')
  const groupId = Number(rest.slice(colon + 1))
  return colon > 0 && Number.isInteger(groupId) ? { accountId: rest.slice(0, colon), groupId } : null
}

/** A change to make on Steam. */
export interface GroupCall {
  accountId: string
  action: 'add' | 'remove' | 'rename' | 'delete' | 'create'
  groupId: number
  steamid?: string
  name?: string
}

/** A folder's name as it is shown: Steam's own list holds some with "Steam - " in front, which its own client does not show. */
export function folderName(name: string): string {
  return name.replace(/^Steam - /, '').trim()
}

export interface SteamSeed {
  categories: CustomCategory[]
  assignment: Record<string, string>
  /** The accounts whose folders have been looked at, whether or not there was anything to make. */
  seeded: string[]
}

/**
 * Starts the direct-messages page from an account's folders, once. Null when there is nothing to do,
 * so the caller writes nothing on the great majority of calls. `groups` has an entry only for an
 * account whose folders have been heard: one that has not said yet is not one with none.
 *
 * An account whose page already has headings from its folders - from before this was done once, when
 * they were followed - is only marked, and its headings are left as they are, bar the "Steam - " that
 * had come to be in front of their names while they were being followed.
 */
export function seedSteamFolders(
  accounts: Account[],
  buffers: BufferEntry[],
  groups: Record<string, SteamGroup[] | undefined>,
  current: { categories: CustomCategory[]; assignment: Record<string, string>; seeded: string[]; followedNames?: Record<string, string> }
): SteamSeed | null {
  let categories = current.categories.map((c) => ({ ...c }))
  const assignment = { ...current.assignment }
  const seeded = [...current.seeded]
  let changed = false

  for (const account of accounts) {
    if (account.service !== 'steam' || seeded.includes(account.id)) continue
    const heard = groups[account.id]
    if (!heard) continue
    const own = `${PREFIX}${account.id}:`
    const had = categories.filter((c) => c.id.startsWith(own))
    if (had.length > 0) {
      for (const c of had) {
        if (c.name === current.followedNames?.[c.id] && c.name !== folderName(c.name)) c.name = folderName(c.name)
      }
    } else {
      const heading = dmCategoryId(account.id)
      const sorted = [...heard].sort((a, b) => a.id - b.id)
      for (const g of sorted) categories.push({ id: steamCategoryId(account.id, g.id), name: folderName(g.name) || g.name })
      for (const b of buffers) {
        if (b.accountId !== account.id || b.kind !== 'dm' || !b.remoteId) continue
        const home = sorted.find((g) => g.members.includes(b.remoteId!))
        // Only a conversation still where the account's heading put it: one a person has put somewhere is theirs.
        if (home && (!assignment[b.id] || assignment[b.id] === heading)) assignment[b.id] = steamCategoryId(account.id, home.id)
      }
    }
    seeded.push(account.id)
    changed = true
  }
  return changed ? { categories, assignment, seeded } : null
}
