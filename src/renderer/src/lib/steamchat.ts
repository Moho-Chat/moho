import type { Buffer } from '../../../shared/wire'

/**
 * Steam chat groups, as the window tells them from everything else Steam is.
 *
 * A group is a server on the rail and its rooms are channels; a friend is a
 * direct message. Both are Steam buffers, so what separates them is the shape
 * of the id the daemon files them under, which is kept in one place so no
 * component has to know it.
 */

/** The group a rail entry is, when it is a Steam chat group: its number as the daemon writes it. */
export function steamGroupOfRail(railId: string): string | null {
  const at = railId.indexOf('|steamgroup:')
  return at < 0 ? null : railId.slice(at + '|steamgroup:'.length) || null
}

/** The group and the room a Steam channel is, from the id the daemon keeps on it. */
export function steamRoomIds(buffer: Pick<Buffer, 'remoteId' | 'kind'> | null | undefined): { group: string; room: string } | null {
  if (!buffer || buffer.kind !== 'channel' || !buffer.remoteId) return null
  const [group, room] = buffer.remoteId.split(':')
  return group && room && /^\d+$/.test(group) && /^\d+$/.test(room) ? { group, room } : null
}

/**
 * The code in an invitation to a group, from a link or the bare code; null
 * for anything else - a friend's invite link, a name - so one box can take
 * either and the right thing is done with each.
 */
export function steamGroupInviteCode(text: string): string | null {
  const t = text.trim()
  const link = /(?:^|\/\/)(?:s\.team\/chat\/|steamcommunity\.com\/chat\/invite\/)([A-Za-z0-9]{4,32})(?:[/?#]|$)/.exec(t)
  return link ? link[1] : null
}

/** What the daemon says about one of the account's groups. */
export interface SteamChatGroup {
  id: string
  railId: string
  name: string
  tagline: string
  owner: string
  myRank: number
  myRankWord: string
  mayModerate: boolean
  mayManage: boolean
  mayInvite: boolean
  mayChangeRoles: boolean
  muted: boolean
  notify: number
  permissions: { key: string; label: string }[]
  rooms: { id: string; name: string; voice: boolean }[]
  roles: { id: string; name: string }[]
  members: { steamid: string; name: string; rank: number; rankWord: string; roles: string[] }[]
  kicked: { steamid: string; name: string }[]
}

/** Notification levels as Steam numbers them, in the order the menu lists them. */
export const STEAM_NOTIFY_LEVELS: { value: number; label: string }[] = [
  { value: 4, label: 'All messages' },
  { value: 3, label: '@everyone and me' },
  { value: 2, label: '@me only' },
  { value: 1, label: 'Nothing' }
]
