import type { CustomCategory } from './categories'

/**
 * Telegram's chat folders, as the categories of the account's page.
 *
 * A folder is a tab of chats on Telegram, and it is drawn here as a category with the conversations on the account's
 * page that it holds. Both sides change the other: a folder made, renamed, deleted or reordered on Telegram turns up
 * here, and the same done to a category here is done on Telegram. The daemon works out what each folder holds (a folder
 * can take chats by kind - every bot, every group - as well as by name) and says it as the list of conversations; this
 * only draws that, so what is shown is what Telegram says.
 *
 * A conversation is under one category here and can be in several folders there. It is drawn under the first folder,
 * in Telegram's order, that holds it.
 */

export interface TelegramFolder {
  id: number
  name: string
  emoticon?: string | null
  /** The conversations it holds, by their Telegram ids (a conversation's `remoteId`). */
  members: string[]
  /** A folder shared by link: it has no rules and no exceptions. */
  shared?: boolean
}

const PREFIX = 'tf:'
const PENDING = 'tfnew:'

/** The category that stands for one of an account's folders. Stable across renames. */
export function telegramCategoryId(accountId: string, folderId: number): string {
  return `${PREFIX}${accountId}:${folderId}`
}

/** Which account and folder a category stands for, if it stands for one. */
export function parseTelegramCategory(id: string): { accountId: string; folderId: number } | null {
  if (!id.startsWith(PREFIX)) return null
  const rest = id.slice(PREFIX.length)
  const colon = rest.lastIndexOf(':')
  const folderId = Number(rest.slice(colon + 1))
  return colon > 0 && Number.isInteger(folderId) ? { accountId: rest.slice(0, colon), folderId } : null
}

/**
 * A category made here that is not a folder yet. Telegram keeps no empty folder, so it is made on Telegram when the
 * first conversation is filed into it; until then it is only drawn.
 */
export function pendingCategoryId(accountId: string): string {
  return `${PENDING}${accountId}:${Date.now().toString(36)}`
}

export function isPendingCategory(id: string): boolean {
  return id.startsWith(PENDING)
}

/** The categories for an account's folders, in Telegram's order. */
export function folderCategories(accountId: string, folders: TelegramFolder[]): CustomCategory[] {
  return folders.map((f) => ({ id: telegramCategoryId(accountId, f.id), name: f.name }))
}

/** Which category each conversation is drawn under: the first folder, in order, that holds it. */
export function folderAssignment(
  accountId: string,
  folders: TelegramFolder[],
  buffers: { id: string; remoteId?: string | null }[]
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const b of buffers) {
    if (!b.remoteId) continue
    const home = folders.find((f) => f.members.includes(b.remoteId!))
    if (home) out[b.id] = telegramCategoryId(accountId, home.id)
  }
  return out
}

/** The folders' numbers in the order the categories are now drawn in. */
export function folderOrder(keys: string[]): number[] {
  return keys.map((k) => parseTelegramCategory(k)?.folderId).filter((n): n is number => n !== undefined)
}
