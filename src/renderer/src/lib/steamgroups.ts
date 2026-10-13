import type { Account } from '../../../shared/wire'
import type { BufferEntry } from '../state/store'
import type { CustomCategory } from './categories'
import { dmCategoryId } from './dmcategories'

/**
 * Steam's friend groups and moho's own categories, kept the same both ways.
 *
 * Steam keeps groups for the account - "Raiders", "Work" - and a friend can be
 * in several. moho already has headings on the direct-messages page that a
 * person makes, renames, fills by dragging and deletes. Rather than a second
 * system beside it, a Steam group is one of those headings: it appears there,
 * its friends' conversations are under it, and what is done to it here is done
 * to the group on Steam, and the other way round.
 *
 * Because both sides change, each thing is remembered as it was last agreed -
 * which heading a conversation was under, what a heading was called - and what
 * has since moved on each side is read against that. A change made here is sent;
 * a change that came from Steam is taken. Nothing is sent for what Steam said.
 *
 * A conversation can be under one heading and a friend in several groups: the
 * lowest-numbered group stands for them, and moving a conversation from one
 * group's heading to another's takes them out of the first and puts them in the
 * second. A conversation filed under a heading that is not a Steam group's is
 * left there, whatever Steam says.
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

/** What was last agreed, kept between runs. */
export interface SteamSyncState {
  /** The group heading each conversation was last under, or '' for none. */
  applied: Record<string, string>
  /** What each group heading was last called, which is also how a heading that has been deleted is known to have been there. */
  names: Record<string, string>
}

/** A change to make on Steam. */
export interface GroupCall {
  accountId: string
  action: 'add' | 'remove' | 'rename' | 'delete'
  groupId: number
  steamid?: string
  name?: string
}

export interface SteamPlan {
  categories: CustomCategory[]
  assignment: Record<string, string>
  state: SteamSyncState
  calls: GroupCall[]
}

/**
 * What to change so the headings and Steam agree. Null when nothing is
 * different, so the caller writes nothing on the great majority of calls.
 * `groups` has an entry only for an account whose groups have been heard: an
 * account that has not said yet is not one with none.
 */
export function planSteamGroups(
  accounts: Account[],
  buffers: BufferEntry[],
  groups: Record<string, SteamGroup[] | undefined>,
  current: { categories: CustomCategory[]; assignment: Record<string, string>; state: SteamSyncState }
): SteamPlan | null {
  let categories = current.categories.map((c) => ({ ...c }))
  const assignment = { ...current.assignment }
  const applied = { ...current.state.applied }
  const names = { ...current.state.names }
  const calls: GroupCall[] = []
  let changed = false

  for (const account of accounts) {
    if (account.service !== 'steam') continue
    const heard = groups[account.id]
    if (!heard) continue
    const byId = new Map(heard.map((g) => [g.id, g]))
    const ownPrefix = `${PREFIX}${account.id}:`
    const heading = dmCategoryId(account.id)

    // The headings: made for a group the first time it is seen, named as it is
    // named, and followed when either side renames it.
    for (const group of [...heard].sort((a, b) => a.id - b.id)) {
      const cid = steamCategoryId(account.id, group.id)
      const have = categories.find((c) => c.id === cid)
      if (!have) {
        if (cid in names) {
          // Made before and gone now: it was deleted here, so the group is too.
          calls.push({ accountId: account.id, action: 'delete', groupId: group.id })
          delete names[cid]
        } else {
          categories.push({ id: cid, name: group.name })
          names[cid] = group.name
        }
        changed = true
        continue
      }
      if (have.name !== names[cid]) {
        // Renamed here since it was last agreed.
        if (have.name !== group.name) calls.push({ accountId: account.id, action: 'rename', groupId: group.id, name: have.name })
        names[cid] = have.name
        changed = true
      } else if (group.name !== have.name) {
        // Renamed on Steam.
        have.name = group.name
        names[cid] = group.name
        changed = true
      }
    }

    // A group gone from Steam takes its heading, and puts its conversations
    // under the account's own.
    for (const category of [...categories]) {
      if (!category.id.startsWith(ownPrefix)) continue
      const parsed = parseSteamCategory(category.id)
      if (!parsed || byId.has(parsed.groupId)) continue
      categories = categories.filter((c) => c.id !== category.id)
      delete names[category.id]
      for (const [buffer, under] of Object.entries(assignment)) {
        if (under === category.id) assignment[buffer] = heading
      }
      for (const [buffer, was] of Object.entries(applied)) {
        if (was === category.id) applied[buffer] = ''
      }
      changed = true
    }

    // The conversations.
    const steamHeading = (cid: string | undefined): string => (cid && cid.startsWith(ownPrefix) ? cid : '')
    for (const buffer of buffers) {
      if (buffer.accountId !== account.id || buffer.kind !== 'dm' || !buffer.remoteId) continue
      const friend = buffer.remoteId
      const here = assignment[buffer.id]
      const hereSteam = steamHeading(here)
      const desiredGroup = [...heard].sort((a, b) => a.id - b.id).find((g) => g.members.includes(friend))
      const desired = desiredGroup ? steamCategoryId(account.id, desiredGroup.id) : ''
      if (!(buffer.id in applied)) {
        // First time seen: what it is under now is what was agreed.
        applied[buffer.id] = hereSteam
        changed = true
      }
      const before = applied[buffer.id]
      if (hereSteam !== before) {
        // Moved here: sent, and what Steam says of it is waited for.
        const from = parseSteamCategory(before)
        const to = parseSteamCategory(hereSteam)
        if (from && byId.get(from.groupId)?.members.includes(friend)) calls.push({ accountId: account.id, action: 'remove', groupId: from.groupId, steamid: friend })
        if (to && byId.has(to.groupId) && !byId.get(to.groupId)?.members.includes(friend)) calls.push({ accountId: account.id, action: 'add', groupId: to.groupId, steamid: friend })
        applied[buffer.id] = hereSteam
        changed = true
      } else if (desired !== before && (!here || here === heading || hereSteam)) {
        // Moved on Steam, and nothing here has said otherwise.
        assignment[buffer.id] = desired || heading
        applied[buffer.id] = desired
        changed = true
      }
    }
  }

  return changed ? { categories, assignment, state: { applied, names }, calls } : null
}
