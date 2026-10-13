import type { Account } from '../../../shared/wire'
import type { BufferEntry } from '../state/store'
import type { CustomCategory } from './categories'
import { serviceLabel } from './util'

/**
 * Direct messages, sorted under a heading per account.
 *
 * Every protocol added puts its conversations on the one direct-messages page,
 * which stops being readable after the second. Each account therefore gets a
 * heading of its own there - "Steam - salastil" - made the first time the
 * account is seen, and its conversations are filed under it as they arrive.
 *
 * The headings are the ordinary ones a person can make for themselves, so
 * everything about them still works: they can be renamed, reordered, collapsed
 * or deleted, and a conversation can be dragged to another. Because of that,
 * this only ever acts once for each thing. A heading that was deleted is not
 * made again, and a conversation that was moved out is not put back; what has
 * been done is remembered rather than re-derived on every change.
 */

/** The services whose conversations land on the direct-messages page. */
const DM_SERVICES = new Set(['irc', 'discord', 'matrix', 'steam'])

const PREFIX = 'dm:'

/** The id of an account's heading. Stable, so a rename does not lose it. */
export function dmCategoryId(accountId: string): string {
  return `${PREFIX}${accountId}`
}

/** "Protocol - Username", the way the heading reads. */
export function dmCategoryName(account: Pick<Account, 'id' | 'service' | 'displayName'>): string {
  const user = account.displayName || account.id.replace(/^[a-z]+:/, '')
  return `${serviceLabel(account.service)} - ${user}`
}

export interface DmCategoryState {
  /** The headings on the direct-messages page. */
  categories: CustomCategory[]
  /** Which heading each conversation is under, by conversation. */
  assignment: Record<string, string>
  /** The conversations already filed once, wherever they are now. */
  filed: string[]
  /** The accounts that have had a heading made, whether or not it is still there. */
  made: string[]
}

/**
 * What to change so every account has its heading and every conversation that
 * has not been filed yet is under its account's. Null when there is nothing to
 * do, so the caller writes nothing on the great majority of calls.
 */
export function planDmCategories(
  accounts: Account[],
  buffers: BufferEntry[],
  current: DmCategoryState
): DmCategoryState | null {
  // Before accounts are known there is nothing to say: an empty list is not
  // "every account was removed".
  if (accounts.length === 0) return null

  let categories = current.categories
  let made = current.made
  const assignment = { ...current.assignment }
  const filed = new Set(current.filed)
  let changed = false

  // A removed account's heading goes with it, and with it the memory of having
  // made it, so adding the account again starts it afresh.
  const live = new Set(accounts.map((a) => a.id))
  const orphan = (c: CustomCategory): boolean => c.id.startsWith(PREFIX) && !live.has(c.id.slice(PREFIX.length))
  if (categories.some(orphan)) {
    categories = categories.filter((c) => !orphan(c))
    changed = true
  }
  if (made.some((id) => !live.has(id))) {
    made = made.filter((id) => live.has(id))
    changed = true
  }

  // The heading, the first time the account is seen.
  for (const account of accounts) {
    if (!DM_SERVICES.has(account.service) || made.includes(account.id)) continue
    if (!categories.some((c) => c.id === dmCategoryId(account.id))) {
      categories = [...categories, { id: dmCategoryId(account.id), name: dmCategoryName(account) }]
    }
    made = [...made, account.id]
    changed = true
  }

  // The conversations, once each. One whose heading has been deleted, or that
  // was put somewhere by hand already, is marked filed and left alone.
  for (const buffer of buffers) {
    if (buffer.kind !== 'dm' || filed.has(buffer.id) || !live.has(buffer.accountId)) continue
    const heading = dmCategoryId(buffer.accountId)
    if (!assignment[buffer.id] && categories.some((c) => c.id === heading)) assignment[buffer.id] = heading
    filed.add(buffer.id)
    changed = true
  }

  return changed ? { categories, assignment, filed: [...filed], made } : null
}
