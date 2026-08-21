// The nobilis wire contract, mirrored from nobilis/src/model.rs. Field names and
// shapes here are not negotiable - the daemon serializes exactly these.

export interface Account {
  id: string
  service: 'irc' | 'discord' | 'sockchat' | 'matrix' | 'jabber' | 'slack'
  displayName: string
  state: string
  autojoin: string
  hasNickservPassword: boolean
  saslEnabled: boolean
  saslUsername: string
  allowPlaintextSasl: boolean
  hasPassword: boolean
  avatarUrl?: string
  sockchatRooms?: SockChatRoom[]
  torMode?: string
  torProxy?: string
  useTor: boolean
  hasKeyBackup: boolean
}

export interface SockChatRoom {
  id: number
  name: string
}

/** `id` is "<accountId>|<name>"; Discord channel names are "Guild/#channel". */
export interface Buffer {
  id: string
  accountId: string
  kind: 'channel' | 'dm' | 'server'
  name: string
  lastActivityTs: number
  avatarUrl?: string
  /** Matrix only - absent, not false, for protocols with no encryption concept. */
  encrypted?: boolean
}

export interface ReplyPreview {
  id: string
  from: string
  body: string
}

export interface Reaction {
  emoji: string
  count: number
  /** Whether this account is among the reactors. */
  me: boolean
  /** Custom Discord emoji only: build the CDN URL with .gif rather than .png. */
  animated?: boolean
}

export interface Embed {
  title?: string
  description?: string
  /** Discord's own decimal RGB value, rendered as a left accent bar. */
  color?: number
  timestamp?: string
  url?: string
}

export interface Message {
  id: string
  bufferId: string
  from: string
  body: string
  ts: number
  isAction: boolean
  isHighlight: boolean
  kind: string
  replyTo?: ReplyPreview
  edited?: boolean
  reactions?: Reaction[]
  isOwn?: boolean
  avatarUrl?: string
  embeds?: Embed[]
  /** Matrix only - the sender's full MXID, for targeting moderation actions. */
  senderId?: string
}

/** presenceChange's member shape. `userId`/`powerLevel` are Matrix-only. */
export interface Member {
  nick: string
  prefix?: string
  away?: boolean
  userId?: string
  powerLevel?: number
}

export interface Protocol {
  id: string
  name: string
}

/** One custom Discord emoji usable in a given buffer's guild. */
export interface CustomEmoji {
  id: string
  name: string
  animated: boolean
}

export interface SockchatSmilie {
  label: string
  aliases: string[]
  /** Filename within the client's bundled sockchat-smilies/ resource dir. */
  file: string
}

export interface MatrixDevice {
  deviceId: string
  displayName?: string | null
  verified: boolean
}

/** One entry from `listDiscordFriends` (a type-1 relationship). */
export interface DiscordFriend {
  userId: string
  username: string
  globalName?: string | null
  avatarUrl?: string | null
  status?: string
}

/** One emoji in a Matrix SAS comparison. */
export interface SasEmoji {
  symbol: string
  description: string
}

export interface MatrixVerification {
  accountId: string
  verificationId: string
  state?: string
  emoji?: SasEmoji[]
}

export interface RoomPermissions {
  canRedactOthers?: boolean
  canKick?: boolean
  canBan?: boolean
  canMute?: boolean
}

/** A push frame: `{event, data}`. */
export interface NobilisEvent {
  event: string
  data: any
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'
