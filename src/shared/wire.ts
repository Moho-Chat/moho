// The nobilis wire contract, mirrored from nobilis/src/model.rs. Field names and
// shapes here are not negotiable - the daemon serializes exactly these.

export interface Account {
  id: string
  service: 'irc' | 'discord' | 'sneedchat' | 'matrix' | 'kick' | 'jabber' | 'slack'
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
  /** Which SASL mechanism this account is pinned to, or '' for the default. */
  saslMechanism: string
  /**
   * Whether a TLS client certificate is configured for SASL EXTERNAL.
   *
   * The path itself is deliberately not reported: a frontend never needs it,
   * and it names a file on whichever machine the daemon runs on rather than
   * this one.
   */
  hasSaslCertificate: boolean
  /**
   * The nick this account is using right now, for IRC.
   *
   * Not the configured one: a session that landed on the alt nick is using
   * that until GHOST reclaims the real one. Needed to tell which row in a
   * member list is you, and therefore whether you hold op.
   */
  currentNick: string
  /**
   * Whether the connection is encrypted. Only IRC is ever false - every other
   * service here is HTTPS or WSS by construction.
   */
  ssl: boolean
  hasPassword: boolean
  avatarUrl?: string
  sneedchatRooms?: SneedChatRoom[]
  torMode?: string
  torProxy?: string
  useTor: boolean
  hasKeyBackup: boolean
}

export interface SneedChatRoom {
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
  /**
   * An IRC channel's own modes, as the server writes them - `+mnt`.
   *
   * Absent until the server has said, which it does on join and on every
   * change. Carried because it answers "why can I not speak here" before the
   * question is asked: `+m` is moderated, `+i` invite-only.
   */
  channelModes?: string
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
  /**
   * Set while the buffer exists but the service has not yet said what is in
   * it - a Matrix room between joining it and its first sync. The list draws
   * a spinner against it and the empty room says so rather than looking like
   * a room with nothing in it.
   */
  syncing?: boolean
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

/**
 * A file somebody has offered over IRC, from the offer through to it being
 * on disk.
 *
 * One type for both because they are one thing to whoever is watching - a
 * file arriving - and being offered is its first state rather than a
 * different kind of object.
 */
export interface DccTransfer {
  id: string
  accountId: string
  /**
   * Which way it is going. Sending and receiving differ in almost nothing
   * else, so they share a list - what somebody wants to see is their
   * transfers, not two separate accounts of them.
   */
  outgoing: boolean
  /** Who offered it, or who it is going to. */
  from: string
  /**
   * What it will be called on disk. Derived by the daemon from what they
   * said, never taken from it: a name off the network cannot be allowed to
   * decide where a file lands.
   */
  fileName: string
  /**
   * What they called it. Shown beside `fileName` where the two differ, so a
   * name that had to be changed is visible rather than quietly substituted.
   */
  rawName: string
  size: number
  received: number
  /** Bytes a second over the last interval, while it is running. */
  rate: number
  state: 'offered' | 'receiving' | 'sending' | 'done' | 'declined' | 'failed'
  /** Where it landed, once it has. */
  path?: string | null
  /** Why it failed, or why it was turned down. */
  error?: string | null
}

/** What receiving files is allowed to do. Lives with the daemon, which is what writes them. */
export interface DccPrefs {
  directory?: string | null
  maxBytes: number
  maxTransfers: number
  /** Bytes a second across every transfer at once; 0 is unlimited. */
  maxRate: number
  autoAccept: boolean
  /** What to publish as this machine's address when sending; blank is automatic. */
  advertisedIp?: string | null
  /** Where files will actually land, with the platform default filled in. */
  resolvedDirectory?: string
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
  /**
   * Whether `id` names a thread rather than one message being answered.
   *
   * The same field carries both because the protocol says both the same way.
   * What differs is what can be done with it: a reply points at something, a
   * thread is somewhere, and only the second can be opened and continued.
   */
  thread?: boolean
}

/**
 * Somebody who has read a conversation as far as a particular message.
 *
 * Matrix calls this a read receipt and is the only protocol here that
 * publishes one, but nothing in the shape is Matrix's: Discord and Sneedchat
 * both know the same fact and could fill this in without the frontend
 * learning a second way to draw it.
 */
export interface MessageReader {
  userId: string
  nick: string
  avatarUrl?: string
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
  /**
   * The colour this service says the sender's name should be.
   *
   * Kick gives everybody one and it is half of how a busy chat is read.
   * Overrides the colour the client derives from the nick, rather than
   * replacing that mechanism — IRC has no such thing and still needs it.
   */
  senderColor?: string
  /** What the sender has earned in this channel. Empty where the service has no such idea. */
  badges?: MessageBadge[]
}

/** presenceChange's member shape. `userId`/`powerLevel` are Matrix-only. */
/**
 * What is known about a person, from whichever service they belong to.
 *
 * Every field is optional because every service answers a different subset:
 * IRC knows an idle time and no account age, Discord knows the day the
 * account was made and nothing about idleness, Matrix knows a power level.
 * The card draws what it was given rather than a fixed form with holes in it.
 */
export interface Profile {
  service: string
  accountId: string
  /** The service's own id, where it has one distinct from the name. */
  id?: string
  /** What to call them - the display name if there is one, else the handle. */
  name: string
  /** The handle underneath the display name, when they differ. */
  handle?: string
  avatarUrl?: string
  /** Unix seconds. When the account itself came into being. */
  createdTs?: number
  /** Unix seconds. When they joined this server, guild or room. */
  joinedTs?: number
  /** Unix seconds. When they were last seen doing anything. */
  lastActiveTs?: number
  /** Seconds since they last spoke or typed, where the service counts that. */
  idleSeconds?: number
  /** Their standing here, in the service's own words - "Moderator", "Op". */
  roles?: string[]
  /** Whether that standing includes moderating this place. */
  isModerator?: boolean
  /** The away message, for a service with away. */
  away?: string
  /** Presence word - "online", "idle", "dnd", "offline". */
  status?: string
  /** Rooms or channels shared with them, where the service will say. */
  channels?: string[]
  /** Anything else worth showing, already phrased for a person to read. */
  extra?: { label: string; value: string }[]
  /** Set while the service is still being asked; the card fills in. */
  pending?: boolean
}

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
export interface MessageBadge {
  /** `moderator`, `subscriber`, `verified`, `og`, `vip`, `founder`… */
  type: string
  /** What the service calls it, which is what a tooltip should say. */
  text: string
  /** Months subscribed, for the badges that count. */
  count?: number
}

export interface CustomEmoji {
  id: string
  name: string
  animated: boolean
  /**
   * Where the picture is, for a service whose emote ids do not imply it.
   *
   * Discord's do - the id alone builds a CDN URL - so its emoji carry no
   * `url` and the client derives one. Kick's are on a different host with a
   * different shape, so the daemon says outright rather than the client
   * keeping a second rule about a second service's CDN.
   */
  url?: string
  /**
   * Subscriber-only, and this account is not subscribed to that channel.
   *
   * Shown rather than hidden: knowing what a subscription would get you is
   * most of the reason the tier exists. It gates sending only - a locked emote
   * still renders in everybody's messages, including this account's view of
   * them.
   */
  locked?: boolean
  /** Which set it belongs to, as a heading in the picker. */
  set?: string
}

export interface SneedchatSmilie {
  label: string
  aliases: string[]
  /** Filename within the client's bundled sneedchat-smilies/ resource dir. */
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
  /**
   * Who is on the other end.
   *
   * For one of your own sessions this is you and the device is the
   * interesting half; for somebody else it is the whole point - a dialog
   * that cannot say whose emoji these are is one nobody should press yes on.
   */
  otherUser?: string
  otherDevice?: string | null
  isSelf?: boolean
  /** Set on an incoming request that has not been answered yet. */
  fromUser?: string
  fromDevice?: string
}

export interface RoomPermissions {
  canRedactOthers?: boolean
  canKick?: boolean
  /** IRC only: whether the local user may give or take channel ranks. */
  canOp?: boolean
  canBan?: boolean
  canMute?: boolean
}

/** A push frame: `{event, data}`. */
export interface NobilisEvent {
  event: string
  data: any
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'
