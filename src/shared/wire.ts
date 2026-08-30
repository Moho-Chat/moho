// The nobilis wire contract, mirrored from nobilis/src/model.rs. Field names and
// shapes here are not negotiable - the daemon serializes exactly these.

export interface Account {
  id: string
  service: 'irc' | 'discord' | 'sockchat' | 'matrix' | 'jabber' | 'slack'
  displayName: string
  /**
   * How the user is presenting: "online" | "idle". Distinct from
   * `state`, which is whether the connection is up.
   */
  status?: string
  state: string
  autojoin: string
  hasNickservPassword: boolean
  saslEnabled: boolean
  saslUsername: string
  allowPlaintextSasl: boolean
  /**
   * Whether the connection is encrypted. Only IRC is ever false - every other
   * service here is HTTPS or WSS by construction.
   */
  ssl: boolean
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
  /** Which rail entry this buffer sits under. */
  groupId?: string
  /** The service's own heading for this buffer - a Discord category. */
  category?: string
  /**
   * The service's own id for this buffer - a Discord channel id. What a
   * `<#id>` in a message body is matched against, so it can be drawn as the
   * channel's name and opened when clicked.
   */
  remoteId?: string
  /** Where the service orders it: category rank and channel rank folded. */
  position?: number
}

/**
 * One entry in the server rail: a Discord guild, a Matrix space, an account's
 * direct messages, or - for protocols with no such concept - the account.
 */
export interface BufferGroup {
  id: string
  accountId: string
  /** Which brand mark to fall back to when there is no icon. */
  service: string
  kind: 'guild' | 'space' | 'dms' | 'account'
  name: string
  /** A local path nobilis already fetched, absent when there is no icon. */
  iconUrl?: string
  position: number
  /**
   * Set while this account has joined but cannot speak yet - Discord's
   * membership screening, where a server wants its rules agreed to first.
   * Absent means no gate, which is the ordinary case.
   */
  pending?: boolean
}

/** A microphone or a set of speakers the sound server offers. */
export interface AudioDevice {
  /** The sound server's own name: stable, and what a stored choice keys on. */
  id: string
  /** What to show a person. */
  name: string
  kind: 'input' | 'output'
  isDefault: boolean
}

/**
 * Which devices voice uses and whether it is silenced.
 *
 * One set per machine rather than per account: there is one microphone and
 * one pair of speakers, whatever you are signed in to.
 */
export interface VoicePrefs {
  /** Device ids, or absent for whatever the sound server defaults to. */
  input?: string
  output?: string
  micMuted: boolean
  deafened: boolean
}

/** Someone sitting in a voice channel. */
export interface VoiceMember {
  userId: string
  nick: string
  isSelf: boolean
  /**
   * Their picture, where one has been seen. A call is mostly faces, and a
   * grid of coloured initials is legible without being who is in the room.
   *
   * Absent for somebody we have only ever seen in a voice channel and never
   * heard from: a direct call's voice states carry no user object to read one
   * out of, so the fallback initial is the honest answer until they speak in
   * the conversation.
   */
  avatarUrl?: string
  /**
   * Sharing a screen or window - Discord's "Go Live". Independent of `video`,
   * which is a camera; somebody can be doing both, and the two look nothing
   * alike to whoever is watching.
   *
   * All four are optional because a daemon older than this field does not
   * send them, and a client has to keep working against one.
   */
  streaming?: boolean
  video?: boolean
  muted?: boolean
  deafened?: boolean
}

export interface VoiceChannel {
  id: string
  name: string
  /** 0 means no limit. */
  userLimit: number
  /** How many people other than us. */
  occupants: number
  /** Nobody else is in it, which is what the empty-only join rule tests. */
  empty: boolean
  /**
   * Who is in it. Optional because a daemon older than this field simply does
   * not send it - and the client has to keep working when it doesn't, since
   * the daemon can be a separately built binary or one already running from
   * before an upgrade.
   */
  members?: VoiceMember[]
}

/**
 * A conversation that is ringing.
 *
 * Deliberately no name or picture: which conversation it is, is the answer,
 * and the buffer already carries how to draw the person it is with.
 */
export interface IncomingCall {
  accountId: string
  bufferId: string
  channelId: string
  ringing: boolean
}

/** Where an account is currently connected in voice. */
export interface VoiceSession {
  accountId: string
  /** Absent on a one-to-one call, which belongs to no guild. */
  guildId?: string
  channelId: string
  channelName: string
  /** A call with a person rather than a room. */
  isDirect: boolean
  /** The conversation the call is in, where one is known. */
  bufferId?: string
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

/**
 * A file attached to a message, described rather than inlined into the body.
 *
 * `path`/`thumbnailPath` are local cache files nobilis has already fetched -
 * the only route to media behind Tor, a Matrix access token, or E2EE
 * decryption. `url` is the remote original: directly loadable for Discord,
 * but not for Sneedchat or Matrix, which is what the local paths are for.
 */
export interface Attachment {
  kind: 'image' | 'video' | 'audio' | 'file'
  mimetype?: string
  filename?: string
  size?: number
  /** Intrinsic dimensions, used to reserve layout space before bytes arrive. */
  width?: number
  height?: number
  blurhash?: string
  path?: string
  thumbnailPath?: string
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
  /**
   * Files attached to this message. Absent on scrollback recorded before
   * nobilis described attachments separately - those messages still carry
   * their media as URLs inside the body, which link unfurling picks up.
   */
  attachments?: Attachment[]
  /**
   * The sender's own formatted version of `body`, where the protocol carries
   * one (Matrix's `formatted_body`). Restricted HTML, and still untrusted -
   * render it through RichText's whitelist like anything else. `body` stays
   * the plain-text fallback and is what search reads.
   */
  html?: string
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
  /**
   * The protocol's own presence word - "online", "idle", "dnd", "offline".
   * Only sent by protocols that actually report presence, so its presence
   * (rather than any service name) is what tells a client the roster can be
   * split into online and offline.
   */
  status?: string
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
