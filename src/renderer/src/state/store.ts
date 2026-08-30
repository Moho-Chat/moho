import type {
  Account,
  AudioDevice,
  Buffer as WireBuffer,
  BufferGroup,
  CustomEmoji,
  IncomingCall,
  MatrixVerification,
  Member,
  Message,
  NobilisEvent,
  Reaction,
  RoomPermissions,
  SockchatSmilie,
  VoiceChannel,
  VoicePrefs,
  VoiceSession
} from '../../../shared/wire'
import { buildSmilieIndex, type SmilieEntry, type SmilieIndex } from '../lib/format'
import { isImageFile, resolveMediaUrl } from '../lib/util'
import { DM_GROUP_ID, isDirectMessage } from '../lib/groups'

/**
 * The whole client-side model, held in one immutable object that is replaced
 * on every change. Components read slices of it through useSyncExternalStore,
 * so a selector that returns a field reference stays referentially stable
 * between unrelated updates and doesn't re-render on them.
 *
 * Event semantics here mirror the original QML frontend exactly; where a rule
 * is non-obvious the reason is noted at the handler.
 */

/** A wire Buffer plus the local-only counters nobilis doesn't track. */
export interface BufferEntry extends WireBuffer {
  unread: number
  highlight: boolean
}

/** A wire Message plus local optimistic-send bookkeeping. */
export interface ChatMessage extends Message {
  /** Set on a locally-echoed message that nobilis hasn't confirmed yet. */
  pending?: boolean
  /** Set once the send definitively failed or timed out. */
  failed?: boolean
  errorText?: string
  /** The body as typed, kept so a retry can resend the original text. */
  pendingBody?: string
  pendingReplyTo?: string
  /** The staged file, kept for the same reason as the body. */
  pendingAttachment?: string
}

export type ActivePanel = '' | 'accounts' | 'settings' | 'join'

export interface ChatState {
  /** Who is composing, per buffer, with when to stop believing it. */
  typingByBuffer: Record<string, { nicks: string[]; until: number }>
  linkUp: boolean
  accounts: Account[]
  buffers: BufferEntry[]
  /** Rail entries - guilds, spaces, DM collections and account entries. */
  groups: BufferGroup[]
  /** Which rail entry the channel pane is showing. */
  activeGroupId: string
  /**
   * Why an account is in the state it is, per account.
   *
   * The daemon reports this on every reconnection cycle - what failed and how
   * long until the next attempt - and it used to be dropped on the floor,
   * which is why an account could sit at "connecting" for five minutes with
   * nothing to read.
   */
  connectionDetail: Record<string, string>
  /** Sound devices and whether voice is silenced, as the daemon sees them. */
  voicePrefs: VoicePrefs
  audioDevices: AudioDevice[]
  /** The selected guild's voice channels, and who is in each. */
  voiceChannels: VoiceChannel[]
  /** Which guild `voiceChannels` describes, so a stale update is ignorable. */
  voiceGuildId: string
  /** Live voice connections, so the pane can show what you are in. */
  voiceSessions: VoiceSession[]
  /** Conversations ringing right now, newest last. */
  incomingCalls: IncomingCall[]
  /**
   * Everything that has mentioned you, newest first, across every service.
   *
   * Held here rather than fetched by the inbox when it opens, because the
   * button carries a count and a count that only becomes true once looked at
   * is no use. Seeded from the daemon - the point of an inbox is the mention
   * in a channel nobody opened, which this client has never seen - and kept
   * current from the live stream afterwards.
   */
  mentions: Message[]
  /**
   * When each buffer was last read, in seconds.
   *
   * Mirrored into state as well as onto disk because the store writes this
   * one through to main directly rather than through the preference hook, so
   * nothing in the renderer's preference cache ever learns it changed. A
   * component reading it from there would have shown whatever was on disk at
   * startup and never moved - which for the mentions inbox meant a mention
   * staying unread after its channel had been opened and read.
   */
  lastReadTs: Record<string, number>
  /**
   * A message the view should scroll to once it has rendered.
   *
   * Held here rather than scrolled to directly, because the log decides its
   * own scroll position - it pins itself to the bottom while you are reading
   * there, and a jump has to turn that off rather than fight it. Cleared by
   * the log once it has done so.
   */
  jumpTarget: string
  activeBufferId: string
  activePanel: ActivePanel
  joinPanelAccountId: string
  messagesByBuffer: Record<string, ChatMessage[]>
  presenceByBuffer: Record<string, Member[]>
  /** Buffers whose initial backlog fetch has completed. */
  loadedBuffers: Record<string, true>
  loadingMore: Record<string, true>
  /** Per-buffer "New messages" divider timestamp, snapshotted on open. */
  dividerTsByBuffer: Record<string, number>
  matrixPermissions: Record<string, RoomPermissions>
  replyingTo: { id: string; from: string; body: string } | null
  toasts: Toast[]

  /** Sneedchat's site-wide smiley table, fetched once and memoised. */
  smilies: SmilieEntry[]
  smilieIndex: SmilieIndex | null
  /** Per-buffer Discord guild emoji, fetched lazily per buffer. */
  bufferEmoji: Record<string, CustomEmoji[]>
  /** The one in-flight Matrix verification, if any (nobilis allows one per account). */
  matrixVerification: MatrixVerification | null

  // Login flows
  discordQrPath: string
  discordLoginStatus: string
  /** Set when a Discord password login stops at the two-factor step. */
  discordMfa: { loginId: string; totp: boolean; sms: boolean; backup: boolean } | null
  /** The account being re-authenticated, or '' for a brand-new one. */
  discordReauthAccountId: string
  sockChatLoginStatus: string
  matrixLoginStatus: string
}

export interface Toast {
  id: number
  kind: 'info' | 'error'
  text: string
}

const INITIAL: ChatState = {
  linkUp: false,
  accounts: [],
  buffers: [],
  groups: [],
  activeGroupId: '',
  connectionDetail: {},
  voicePrefs: { micMuted: false, deafened: false },
  audioDevices: [],
  voiceChannels: [],
  voiceGuildId: '',
  voiceSessions: [],
  incomingCalls: [],
  mentions: [],
  lastReadTs: {},
  jumpTarget: '',
  activeBufferId: '',
  activePanel: '',
  joinPanelAccountId: '',
  messagesByBuffer: {},
  presenceByBuffer: {},
  loadedBuffers: {},
  loadingMore: {},
  dividerTsByBuffer: {},
    typingByBuffer: {},
  matrixPermissions: {},
  replyingTo: null,
  toasts: [],
  smilies: [],
  smilieIndex: null,
  bufferEmoji: {},
  matrixVerification: null,
  discordQrPath: '',
  discordLoginStatus: '',
  discordMfa: null,
  discordReauthAccountId: '',
  sockChatLoginStatus: '',
  matrixLoginStatus: ''
}

/**
 * A call whose failure is not worth reporting and not worth retrying here.
 *
 * Subscribing is the case this exists for: it is re-issued for every buffer
 * each time the buffer list loads, so one that fails because the daemon link
 * is momentarily down repairs itself on reconnect. Left as a bare `void` these
 * became unhandled rejections - one per buffer, on every buffer list load and
 * every channel opened - which fills the console and buries real errors. A
 * toast each would be worse still, since a dropped link fails all of them at
 * once.
 */
/**
 * Whether a message that arrived is the one we just sent.
 *
 * Normally the bodies are identical. A reply on a service with no reply field
 * is the exception: Sneedchat answers somebody by opening the message with an
 * "@Name," mention, which the daemon adds on the way out, so what comes back
 * is longer than what was typed. Matching those strictly left the sent message
 * showing as failed while its own echo appeared beside it as a new message.
 *
 * The looser match is deliberately narrow - only for a message that was sent
 * as a reply, and only when the arriving body ends with exactly what was
 * typed - so an unrelated message that happens to share a suffix cannot
 * swallow somebody's pending send.
 */
function echoMatches(echo: ChatMessage, real: Message): boolean {
  if (echo.pendingBody === real.body) return true
  return !!echo.pendingReplyTo && !!echo.pendingBody && real.body.endsWith(echo.pendingBody)
}

/**
 * Trims a failure report down to the part that explains anything.
 *
 * These arrive with the full request URL in them, and a Matrix sync URL
 * carries a sync token longer than the rest of the message combined - which
 * matters because the actual reason and the retry countdown are at the *end*,
 * so a line truncated to fit shows nothing but an opaque token.
 */
function tidyDetail(detail: string): string {
  return detail.replace(/(https?:\/\/[^\s)]+?)\?[^\s)]*/g, '$1')
}

/** The upload host the person chose, or the default if they never did. */
/**
 * Every host the daemon offers, fetched once.
 *
 * Cached because it is asked on every send with an attachment and cannot
 * change while the daemon is up - the list is compiled into it.
 */
let hostListing: Promise<{ id: string; accepts: string[] | null }[]> | null = null

async function uploadHosts(): Promise<{ id: string; accepts: string[] | null }[]> {
  if (!hostListing) {
    hostListing = window.moho
      .rpc<{ id: string; accepts: string[] | null }[]>('listUploadHosts')
      // An older daemon says nothing about what a host takes; assume it
      // takes whatever it is given, which is what happened before this.
      .catch(() => [])
  }
  return hostListing
}

/** Whether this host will take this file, by the daemon's own account. */
async function hostAccepts(hostId: string, path: string): Promise<boolean> {
  const host = (await uploadHosts()).find((h) => h.id === hostId)
  if (!host || !host.accepts) return true
  const ext = (path.split(/[\\/]/).pop() || '').split('.').pop()?.toLowerCase() ?? ''
  return host.accepts.includes(ext)
}

/**
 * Where this file should go, for this service.
 *
 * Chosen by service and by whether the file is a picture, because the answer
 * differs on both counts: postimg.cc is the convention on Sneedchat and
 * meaningless on IRC, and it takes images and nothing else. Read at send
 * time, since it is a preference somebody may change between one message and
 * the next.
 *
 * A host that will not take this particular file is routed around rather
 * than allowed to refuse it - postimg does not accept avif, which is an
 * image by any ordinary reading. It goes to the host already chosen for
 * everything else, not to one invented here: that is a decision somebody
 * made, and a file should not turn up at a third party they never named.
 *
 * The old single setting is the fallback for anyone who chose a host before
 * this was split in two.
 */
async function uploadHost(service: string | undefined, attachmentPath: string): Promise<string> {
  const kind = isImageFile(attachmentPath) ? 'images' : 'media'
  const perService = service === 'sockchat' ? 'sockchat' : 'irc'
  try {
    const prefs = await window.moho.prefs.getAll()
    const legacy = prefs['uploads.host'] as string | undefined
    // postimg takes images and nothing else, so a stored choice of it is
    // carried forward for pictures and not for anything else.
    const legacyUsable = legacy === 'postimg' ? kind === 'images' : !!legacy
    const fallback = kind === 'images' && perService === 'sockchat' ? 'postimg' : 'catbox'
    const chosen =
      (prefs[`uploads.${perService}.${kind}`] as string | undefined) ||
      (legacyUsable ? legacy : undefined) ||
      fallback

    if (await hostAccepts(chosen, attachmentPath)) return chosen

    const other = prefs[`uploads.${perService}.media`] as string | undefined
    if (other && other !== chosen && (await hostAccepts(other, attachmentPath))) return other
    return 'catbox'
  } catch {
    return 'catbox'
  }
}

/**
 * This account's own reaction added to or taken off a tally.
 *
 * Only ever moves our own vote: the count follows because we are one of the
 * reactors, and everyone else's stays where it is. A tally that reaches zero
 * disappears, the same as it does when the service reports it, so an
 * optimistic row and a real one look alike.
 */
function applyOwnReaction(list: Reaction[], emoji: string, add: boolean): Reaction[] {
  const existing = list.find((r) => r.emoji === emoji)
  if (!existing) {
    return add ? [...list, { emoji, count: 1, me: true }] : list
  }
  // Already in the state being asked for - the service will say the same.
  if (existing.me === add) return list
  const count = Math.max(0, existing.count + (add ? 1 : -1))
  if (count === 0) return list.filter((r) => r.emoji !== emoji)
  return list.map((r) => (r.emoji === emoji ? { ...r, count, me: add } : r))
}

function bestEffort(work: Promise<unknown>, what: string): void {
  void work.catch((e: Error) => console.debug(`[moho] ${what}:`, e.message))
}

/**
 * Scrollback kept in memory per buffer. Older messages stay in nobilis's SQLite
 * store and come back through getBacklog when the user scrolls up, so this cap
 * bounds memory without losing history.
 */
const MAX_MESSAGES_PER_BUFFER = 500
/** As many mentions as the inbox will hold; the daemon's own limit matches. */
const MAX_MENTIONS = 100
const BACKLOG_PAGE = 200
const SEND_TIMEOUT_MS = 10000

export class ChatStore {
  private state: ChatState = INITIAL
  private listeners = new Set<() => void>()
  private sendSeq = 0
  /** clientId -> the optimistic message awaiting its real echo. */
  private pendingSends = new Map<string, { bufferId: string; ts: number }>()
  private toastSeq = 0
  private sweepTimer: ReturnType<typeof setInterval> | null = null
  private mentionsTimer: ReturnType<typeof setTimeout> | null = null

  getSnapshot = (): ChatState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(patch: Partial<ChatState>): void {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }

  // --- lifecycle ------------------------------------------------------

  async init(initialBufferId: string, initialGroupId = ''): Promise<void> {
    this.set({ activeBufferId: initialBufferId, activeGroupId: initialGroupId })

    const stored = await window.moho.prefs.getAll()
    this.set({ lastReadTs: (stored.lastReadTs as Record<string, number>) ?? {} })

    window.moho.onLinkChange((up) => {
      this.set({ linkUp: up })
      if (up) void this.refreshAll()
    })
    window.moho.onEvent((frame) => this.handleEvent(frame))
    window.moho.onActivateBuffer((id) => void this.selectBuffer(id))

    this.sweepTimer = setInterval(() => this.sweepPendingSends(), 2000)

    // The link may already be up before this renderer finished loading (main
    // connects at startup), in which case no 'link' event is coming.
    const status = await window.moho.daemonStatus()
    this.set({ linkUp: status.linkUp })
    if (status.linkUp) await this.refreshAll()
  }

  dispose(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    if (this.mentionsTimer) clearTimeout(this.mentionsTimer)
  }

  private async refreshAll(): Promise<void> {
    await Promise.all([
      this.refreshAccounts(),
      this.refreshBuffers(),
      this.refreshGroups(),
      this.refreshVoicePrefs(),
      // A call outlives this window: the daemon holds it, so a reconnecting
      // or restarted client has to pick the connection back up rather than
      // showing nothing while audio is still flowing.
      this.refreshVoiceSessions(),
      this.refreshIncomingCalls()
    ])
    if (this.state.activeBufferId) await this.selectBuffer(this.state.activeBufferId)
  }

  /**
   * The mentions that arrived before this client did.
   *
   * A failure here is silent rather than a toast: an empty inbox is a mild
   * disappointment, and interrupting someone to say so - on every reconnect,
   * which is when this runs - would be worse than the missing list.
   */
  async refreshMentions(): Promise<void> {
    try {
      this.set({ mentions: await window.moho.rpc<Message[]>('getMentions', { limit: MAX_MENTIONS }) })
    } catch {
      // Leave whatever is already there; a reconnect should not empty it.
    }
  }

  async refreshAccounts(): Promise<void> {
    try {
      this.set({ accounts: await window.moho.rpc<Account[]>('listAccounts') })
    } catch (e) {
      this.toast('error', `Couldn't list accounts: ${(e as Error).message}`)
    }
  }

  /**
   * The rail. Kept in nobilis's order (its own `position`, then name), which
   * for Discord is the order the user arranged their servers in.
   */
  async refreshGroups(): Promise<void> {
    try {
      const groups = await window.moho.rpc<BufferGroup[]>('listBufferGroups')
      this.set({ groups })
      // A session saved before direct messages were folded into one page may
      // still name a per-account DM group, which no longer has a tile. Point
      // it at the page that replaced it rather than letting the pane fall back
      // to whatever entry happens to be first.
      const active = groups.find((g) => g.id === this.state.activeGroupId)
      if (active?.kind === 'dms') this.selectGroup(DM_GROUP_ID)
      // Land somewhere sensible on first run rather than an empty pane.
      if (!this.state.activeGroupId && groups.length) {
        this.set({ activeGroupId: this.groupOfActiveBuffer() || groups[0].id })
      }
    } catch (e) {
      this.toast('error', `Couldn't list servers: ${(e as Error).message}`)
    }
  }

  /** Keeps the rail selection on whatever buffer is already open. */
  private groupOfActiveBuffer(): string {
    const active = this.state.buffers.find((b) => b.id === this.state.activeBufferId)
    return active?.groupId || ''
  }

  /**
   * A guild arriving, or one re-registering once its icon finished
   * downloading. Replaced by id rather than appended, then re-sorted so a
   * late arrival lands in the right place instead of at the end.
   */
  /**
   * Takes a rail entry away, after leaving what it stood for.
   *
   * Also moves off it if it was the one being read: the pane below would
   * otherwise be showing the channels of somewhere that no longer exists.
   */
  private removeGroup(groupId: string): void {
    const groups = this.state.groups.filter((g) => g.id !== groupId)
    this.set({ groups })
    if (this.state.activeGroupId === groupId) {
      this.set({ activeGroupId: groups[0]?.id ?? '', activeBufferId: '' })
    }
  }

  private upsertGroup(group: BufferGroup): void {
    const rest = this.state.groups.filter((g) => g.id !== group.id)
    const groups = [...rest, group].sort(
      (a, b) => a.position - b.position || a.name.localeCompare(b.name)
    )
    this.set({ groups })
    if (!this.state.activeGroupId) this.set({ activeGroupId: groups[0].id })
  }

  /**
   * Sets how an account presents itself.
   *
   * Refreshes the account list rather than patching state locally: nobilis
   * reports whether it could actually apply the status, and for a
   * disconnected account or a protocol with no presence concept the answer is
   * no - showing it as set anyway would be a lie.
   */
  /**
   * The microphone and speaker state, which the daemon owns.
   *
   * Read back rather than assumed: a mute survives a restart, so the button
   * has to show what is actually in force rather than what this window last
   * set.
   */
  async refreshVoicePrefs(): Promise<void> {
    try {
      this.set({ voicePrefs: await window.moho.rpc<VoicePrefs>('getVoicePrefs') })
    } catch {
      // Voice is optional; a daemon that cannot answer just means no controls.
    }
  }

  async refreshAudioDevices(): Promise<void> {
    try {
      this.set({ audioDevices: await window.moho.rpc<AudioDevice[]>('listAudioDevices') })
    } catch (e) {
      this.toast('error', `Couldn't list sound devices: ${(e as Error).message}`)
    }
  }

  async setVoiceMuted(next: { micMuted?: boolean; deafened?: boolean }): Promise<void> {
    // Applied optimistically: a mute button that waits for a round trip feels
    // broken, and the daemon's reply corrects it either way.
    this.set({ voicePrefs: { ...this.state.voicePrefs, ...next } })
    try {
      this.set({ voicePrefs: await window.moho.rpc<VoicePrefs>('setVoiceMuted', next) })
    } catch (e) {
      this.toast('error', `Couldn't change audio: ${(e as Error).message}`)
      await this.refreshVoicePrefs()
    }
  }

  async setVoiceDevice(kind: 'input' | 'output', deviceId: string): Promise<void> {
    try {
      this.set({ voicePrefs: await window.moho.rpc<VoicePrefs>('setVoiceDevice', { kind, deviceId }) })
    } catch (e) {
      this.toast('error', `Couldn't select that device: ${(e as Error).message}`)
    }
  }

  /**
   * The voice channels of whichever guild is on screen.
   *
   * Fetched per guild rather than kept for all of them: membership changes
   * constantly across every server someone is in, and only the one being
   * looked at is worth tracking.
   */
  async refreshVoiceChannels(accountId: string, guildId: string): Promise<void> {
    try {
      const channels = await window.moho.rpc<VoiceChannel[]>('listVoiceChannels', { accountId, guildId })
      this.set({ voiceChannels: channels, voiceGuildId: guildId })
    } catch {
      // Only Discord has these; anything else legitimately has none.
      this.set({ voiceChannels: [], voiceGuildId: guildId })
    }
  }

  async refreshVoiceSessions(): Promise<void> {
    try {
      this.set({ voiceSessions: await window.moho.rpc<VoiceSession[]>('getVoiceSession') })
    } catch {
      this.set({ voiceSessions: [] })
    }
  }

  /**
   * What is ringing, asked for at startup.
   *
   * The daemon holds the connection while this window is shut, so a call can
   * begin ringing before there is anything to show it - opening the window
   * mid-call would otherwise be silent while the caller waits.
   */
  async refreshIncomingCalls(): Promise<void> {
    try {
      this.set({ incomingCalls: await window.moho.rpc<IncomingCall[]>('getIncomingCalls') })
    } catch {
      // An older daemon has no such method; no calls is the honest answer.
      this.set({ incomingCalls: [] })
    }
  }

  /**
   * Leaves a guild or space for real.
   *
   * The daemon takes the rail entry away once the server has agreed, so
   * nothing is removed here on optimism - leaving is the one action where
   * showing it as done before it is would be worse than a moment's delay.
   */
  async leaveGroup(groupId: string): Promise<void> {
    try {
      await window.moho.rpc('leaveGroup', { groupId })
    } catch (e) {
      this.toast('error', `Couldn't leave: ${(e as Error).message}`)
    }
  }

  /** Asks the log to scroll to a message, and to stop following the tail. */
  setJumpTarget(messageId: string): void {
    this.set({ jumpTarget: messageId })
  }

  private setRinging(call: IncomingCall): void {
    const others = this.state.incomingCalls.filter((c) => c.bufferId !== call.bufferId)
    this.set({ incomingCalls: call.ringing ? [...others, call] : others })
  }

  /** Answers a ringing call, and opens the conversation it is in. */
  async acceptCall(bufferId: string): Promise<void> {
    // Optimistic: the ringing stops the instant it is answered, rather than a
    // round trip later with the ringtone still going.
    this.setRinging({ ...this.callFor(bufferId), ringing: false })
    try {
      await window.moho.rpc('acceptCall', { bufferId })
      await this.selectBuffer(bufferId, true)
      await this.refreshVoiceSessions()
    } catch (e) {
      this.toast('error', `Couldn't answer: ${(e as Error).message}`)
    }
  }

  async declineCall(bufferId: string): Promise<void> {
    this.setRinging({ ...this.callFor(bufferId), ringing: false })
    try {
      await window.moho.rpc('declineCall', { bufferId })
    } catch (e) {
      this.toast('error', `Couldn't decline: ${(e as Error).message}`)
    }
  }

  private callFor(bufferId: string): IncomingCall {
    const known = this.state.incomingCalls.find((c) => c.bufferId === bufferId)
    return known ?? { accountId: '', bufferId, channelId: '', ringing: false }
  }

  async joinVoice(accountId: string, guildId: string, channelId: string): Promise<void> {
    try {
      // soloOnly is off here because a person clicking a channel in a list
      // that shows them who is already in it has chosen to join those people.
      await window.moho.rpc('joinVoiceChannel', { accountId, guildId, channelId, soloOnly: false, transmit: true })
      await Promise.all([this.refreshVoiceSessions(), this.refreshVoiceChannels(accountId, guildId)])
    } catch (e) {
      this.toast('error', `Couldn't join voice: ${(e as Error).message}`)
    }
  }

  /**
   * Calls whoever is on the other end of a conversation.
   *
   * Takes a buffer rather than a user because that is what both callers have
   * - a row in the list, or the conversation on screen - and the daemon
   * resolves it to the channel the call happens in.
   */
  async callBuffer(bufferId: string): Promise<void> {
    try {
      await window.moho.rpc('startDiscordCall', { bufferId })
      await this.refreshVoiceSessions()
    } catch (e) {
      this.toast('error', `Couldn't call: ${(e as Error).message}`)
    }
  }

  async leaveVoice(accountId: string): Promise<void> {
    try {
      await window.moho.rpc('leaveVoiceChannel', { accountId })
      await this.refreshVoiceSessions()
    } catch (e) {
      this.toast('error', `Couldn't leave voice: ${(e as Error).message}`)
    }
  }

  /**
   * Connects or disconnects an account.
   *
   * The same thing the Accounts page does; exposed here because presence and
   * connection are one choice to a person - "offline" is not a mood, it is
   * being gone.
   */
  async setAccountConnected(accountId: string, connected: boolean): Promise<void> {
    try {
      await window.moho.rpc('setAccountConnected', { accountId, connected })
      await this.refreshAccounts()
    } catch (e) {
      this.toast('error', `Couldn't ${connected ? 'connect' : 'disconnect'}: ${(e as Error).message}`)
    }
  }

  /**
   * How this account should present itself, including not at all.
   *
   * Online and idle on a disconnected account connect it first - choosing to
   * appear online while signed out otherwise does nothing visible, which is
   * the kind of switch people press twice and then distrust. The status is
   * recorded either way and applied when the connection comes up.
   */
  async setPresence(accountId: string, status: 'online' | 'idle' | 'offline'): Promise<void> {
    if (status === 'offline') return this.setAccountConnected(accountId, false)

    const state = this.state.accounts.find((a) => a.id === accountId)?.state
    await this.setAccountStatus(accountId, status)
    if (state === 'connected') return

    // An attempt already running is stopped before starting another. Without
    // this, choosing a status on an account stuck retrying did nothing
    // visible: the state was "connecting" before and after, so the only way
    // out was the Accounts page - which had the same dead button.
    if (state === 'connecting') await this.setAccountConnected(accountId, false)
    await this.setAccountConnected(accountId, true)
  }

  async setAccountStatus(accountId: string, status: 'online' | 'idle'): Promise<void> {
    try {
      await window.moho.rpc('setAccountStatus', { accountId, status })
      await this.refreshAccounts()
    } catch (e) {
      this.toast('error', `Couldn't set status: ${(e as Error).message}`)
    }
  }

  selectGroup(groupId: string): void {
    if (groupId === this.state.activeGroupId) return
    this.set({ activeGroupId: groupId })
    void window.moho.prefs.set('ui.activeGroupId', groupId)
  }

  async refreshBuffers(): Promise<void> {
    try {
      const wire = await window.moho.rpc<WireBuffer[]>('listBuffers')
      const existing = new Map(this.state.buffers.map((b) => [b.id, b]))
      const buffers = wire.map((b) => ({
        unread: existing.get(b.id)?.unread ?? 0,
        highlight: existing.get(b.id)?.highlight ?? false,
        ...b
      }))
      this.set({ buffers })
      // "message" is a scoped event - nobilis only delivers it for buffers this
      // connection explicitly subscribed to. Without subscribing to every
      // buffer up front, one that's never been opened would never bump its
      // own unread count.
      for (const b of buffers)
        bestEffort(window.moho.rpc('subscribe', { bufferId: b.id }), `subscribe ${b.id}`)
      // The daemon answers "what mentioned me" over the channels it currently
      // knows about, and at startup that is almost none of them - the accounts
      // are still connecting. This first ask is worth making anyway for a
      // reconnect, where they are all already there; the arrival of each
      // channel schedules another.
      void this.refreshMentions()
    } catch (e) {
      this.toast('error', `Couldn't list buffers: ${(e as Error).message}`)
    }
  }

  // --- push events ----------------------------------------------------

  private handleEvent(frame: NobilisEvent): void {
    const { event, data } = frame
    switch (event) {
      case 'message':
        // An echo of our own send resolves the optimistic row in place; only
        // an unmatched message is a genuinely new one to append.
        if (!data.isOwn || !this.reconcileOwnEcho(data)) this.appendMessage(data.bufferId, data)
        break

      case 'messageUpdated':
        // `edited` comes from the event rather than being hardcoded true: a
        // backend-internal body rewrite (Sneedchat swapping in a Tor-fetched
        // local copy of an attachment) reuses this event with edited:false and
        // must not show the "(edited)" label. OR'd with the current value so a
        // genuine earlier edit isn't clobbered by a later silent rewrite.
        this.mapMessage(data.bufferId, data.id, (m) => ({
          ...m,
          // A thumbnail landing or links being re-signed carries attachments
          // only - no body, no embeds - so those must not be blanked out.
          body: data.body ?? m.body,
          edited: m.edited || !!data.edited,
          embeds: data.embeds ?? m.embeds ?? [],
          attachments: data.attachments ?? m.attachments
        }))
        break

      case 'messageDeleted':
        this.setMessages(
          data.bufferId,
          (this.state.messagesByBuffer[data.bufferId] || []).filter((m) => m.id !== data.id)
        )
        break

      case 'reactionsChanged':
        this.mapMessage(data.bufferId, data.id, (m) => ({ ...m, reactions: data.reactions }))
        break

      case 'bufferListChange':
        this.handleBufferListChange(data)
        break

      // Somebody is writing. Discord names one person per event and Matrix
      // sends the whole set, including an empty one to say everybody
      // stopped - so a list replaces, and a single nick is merged in.
      case 'typing': {
        const until = Date.now() + (data.expiresInMs ?? 10000)
        const current = this.state.typingByBuffer[data.bufferId]
        const nicks: string[] = data.nicks
          ? data.nicks
          : Array.from(new Set([...(current && current.until > Date.now() ? current.nicks : []), data.nick]))
        this.set({
          typingByBuffer: { ...this.state.typingByBuffer, [data.bufferId]: { nicks, until } }
        })
        break
      }

      // Read on another device. Discord echoes an ack to every session an
      // account has, including the one that sent it, so this settles our own
      // count as well as following somebody's phone.
      case 'bufferRead':
        this.set({
          buffers: this.state.buffers.map((b) =>
            b.id === data.bufferId ? { ...b, unread: 0, highlight: false } : b
          )
        })
        break

      case 'bufferGroupChange':
        // A leave arrives as a removal rather than a new shape. Passing that
        // to the upsert would add a rail entry with no name and no service.
        if (data.removed) this.removeGroup(data.id as string)
        else this.upsertGroup(data as BufferGroup)
        break

      // The call itself came up or went away. Separate from membership
      // because these fire for our own connection, which is what decides
      // whether the connected panel is on screen at all.
      case 'discordVoiceConnected':
      case 'discordVoiceLeft':
      case 'discordVoiceError':
        void this.refreshVoiceSessions()
        break

      // A conversation started or stopped ringing.
      case 'incomingCall':
        this.setRinging(data as IncomingCall)
        break

      // Somebody joined or left a voice channel in a guild we may be showing.
      case 'voiceMembershipChanged':
        if (data.guildId === this.state.voiceGuildId) {
          void this.refreshVoiceChannels(data.accountId, data.guildId)
        }
        void this.refreshVoiceSessions()
        break

      // The server said the message went nowhere. Recorded in the
      // conversation rather than as a toast: it belongs beside the message it
      // is about, and is still true when you scroll back to it tomorrow.
      case 'deliveryFailed':
        this.appendMessage(data.bufferId, {
          id: `notice-${++this.sendSeq}-${Date.now()}`,
          bufferId: data.bufferId,
          from: '',
          body: data.text,
          ts: Math.floor(Date.now() / 1000),
          isAction: false,
          isHighlight: false,
          kind: 'notice',
          isOwn: false
        })
        break

      // Another window, or the daemon itself, changed the audio state.
      case 'voicePrefsChanged':
        this.set({ voicePrefs: data as VoicePrefs })
        break

      case 'presenceChange':
        this.set({
          presenceByBuffer: { ...this.state.presenceByBuffer, [data.bufferId]: data.members }
        })
        break

      case 'connectionState':
        this.handleConnectionState(data)
        break

      // nobilis names these fields `qrCodePath` and `detail`; reading `path`
      // and `status` silently yielded empty strings, which is why the QR
      // never appeared and login progress text stayed blank.
      case 'discordLoginQr':
        this.set({ discordQrPath: data.qrCodePath || '', discordLoginStatus: 'Scan the code' })
        break
      case 'discordLoginScanned':
        this.set({ discordLoginStatus: 'Scanned - approve it on your phone' })
        break
      case 'discordLoginMfa':
        this.set({
          discordMfa: {
            loginId: data.loginId,
            totp: !!data.totp,
            sms: !!data.sms,
            backup: !!data.backup
          },
          discordLoginStatus: ''
        })
        break

      case 'discordLoginResult':
        this.set({
          discordQrPath: '',
          discordLoginStatus: data.error || '',
          // A failure leaves the form open to try again; success clears it.
          discordMfa: data.error ? this.state.discordMfa : null,
          discordReauthAccountId: data.error ? this.state.discordReauthAccountId : ''
        })
        if (!data.error) {
          void this.refreshAccounts()
          void this.refreshBuffers()
        }
        break

      case 'discordLoginStatus':
        this.set({ discordLoginStatus: data.detail || '' })
        break

      case 'sockChatLoginStatus':
        this.set({ sockChatLoginStatus: data.detail || '' })
        break
      case 'sockChatLoginResult':
        this.set({ sockChatLoginStatus: data.error || '' })
        // Refreshed either way. The daemon now saves the account before it
        // attempts the login, so a wrong password or a Tor bootstrap that
        // never finished leaves an account sitting there to correct and
        // retry - and refreshing only on success was what kept it invisible.
        void this.refreshAccounts()
        break

      // Verification is a multi-step flow whose steps all arrive as pushes:
      // a status change, then the emoji to compare, then a final result.
      case 'matrixVerificationStatus':
        this.set({
          matrixVerification: { ...(this.state.matrixVerification || {}), ...data }
        })
        break
      case 'matrixVerificationEmoji':
        this.set({
          matrixVerification: {
            ...(this.state.matrixVerification || {}),
            ...data,
            state: 'emoji'
          }
        })
        break
      case 'matrixVerificationResult':
        if (data.success) {
          this.toast('info', 'Session verified')
          this.set({ matrixVerification: { ...data, state: 'done' } })
          // Clear the banner shortly after, once the panel has reacted to
          // "done" by refetching the (now verified) device list.
          setTimeout(() => this.set({ matrixVerification: null }), 1500)
        } else {
          this.toast('error', `Verification failed: ${data.error || 'cancelled'}`)
          this.set({ matrixVerification: null })
        }
        void this.refreshAccounts()
        break

      case 'matrixLoginStatus':
        this.set({ matrixLoginStatus: data.detail || '' })
        break
      case 'matrixLoginResult':
        this.set({ matrixLoginStatus: data.error || '' })
        // Same as Sneedchat above: the account exists before the attempt, so
        // a failure has something to show and something to retry.
        void this.refreshAccounts()
        break

      default:
        break
    }
  }

  private handleBufferListChange(data: WireBuffer & { removed?: boolean }): void {
    const { buffers } = this.state
    if (data.removed) {
      this.set({ buffers: buffers.filter((b) => b.id !== data.id) })
      return
    }
    const known = buffers.find((b) => b.id === data.id)
    if (known) {
      // A re-broadcast of an already-known buffer (its lastActivityTs just
      // bumped). Merge the fresh server fields, keeping local-only unread and
      // highlight rather than resetting them.
      this.set({ buffers: buffers.map((b) => (b.id === data.id ? { ...b, ...data } : b)) })
      return
    }
    this.set({ buffers: [...buffers, { unread: 0, highlight: false, ...data }] })
    bestEffort(window.moho.rpc('subscribe', { bufferId: data.id }), `subscribe ${data.id}`)
    // A channel this client had not heard of may already hold mentions in the
    // stored history, so the inbox has to ask again now that the daemon can
    // see it. This is the only moment it can: channels register one at a time
    // as each account finishes connecting, long after the startup fetch.
    if (data.kind === 'channel') this.scheduleMentionsRefresh()
  }

  /**
   * Re-asks for mentions once the channels stop arriving.
   *
   * Debounced because they arrive in a burst - one event per channel, and a
   * Discord account alone can register a few hundred - and running the query
   * once per channel would mean hundreds of identical answers to reach the
   * same list the last one gives.
   */
  private scheduleMentionsRefresh(): void {
    if (this.mentionsTimer) clearTimeout(this.mentionsTimer)
    this.mentionsTimer = setTimeout(() => {
      this.mentionsTimer = null
      void this.refreshMentions()
    }, 1500)
  }

  private handleConnectionState(data: {
    accountId: string
    state: string
    error?: string
    detail?: string
  }): void {
    const { accounts } = this.state

    // Kept only while it explains something. A connected account's last
    // failure is history, and leaving it on screen reads as a current problem.
    const detail = { ...this.state.connectionDetail }
    if (data.detail && data.state !== 'connected') detail[data.accountId] = tidyDetail(data.detail)
    else delete detail[data.accountId]
    this.set({ connectionDetail: detail })
    // Upsert rather than map-update: this connection also observes accounts
    // added elsewhere (nobilis reconnecting saved accounts at startup, another
    // client) that this session's list never had to begin with.
    if (accounts.some((a) => a.id === data.accountId)) {
      this.set({
        accounts: accounts.map((a) => (a.id === data.accountId ? { ...a, state: data.state } : a))
      })
    } else {
      void this.refreshAccounts()
    }
    if (data.error) this.toast('error', `${data.accountId}: ${data.error}`)
  }

  // --- messages -------------------------------------------------------

  /**
   * The one place a buffer's list is replaced, and the one place ids are
   * guaranteed unique.
   *
   * Deduplicated here rather than trusted from the daemon, because the cost of
   * a repeat is out of all proportion to the mistake. The rendered rows are
   * keyed by message id; two rows sharing a key leave React unable to
   * reconcile the list, and switching conversations then strands some of the
   * old one's rows on screen above the new one's - which reads as one
   * channel's history leaking into another's rather than as a duplicate.
   * A message id names a message, so keeping the first of a repeated id loses
   * nothing.
   */
  private setMessages(bufferId: string, list: ChatMessage[]): void {
    const seen = new Set<string>()
    const unique = list.filter((m) => !seen.has(m.id) && (seen.add(m.id), true))
    this.set({ messagesByBuffer: { ...this.state.messagesByBuffer, [bufferId]: unique } })
  }

  private mapMessage(
    bufferId: string,
    id: string,
    fn: (m: ChatMessage) => ChatMessage
  ): void {
    const list = this.state.messagesByBuffer[bufferId]
    if (!list) return
    this.setMessages(
      bufferId,
      list.map((m) => (m.id === id ? fn(m) : m))
    )
  }

  private appendMessage(bufferId: string, msg: Message): void {
    const existing = this.state.messagesByBuffer[bufferId] || []
    // nobilis can re-broadcast a message we already hold (a reconnect replaying
    // recent history); appending it again would show a visible duplicate.
    if (existing.some((m) => m.id === msg.id)) return

    const list = [...existing, msg as ChatMessage]
    this.setMessages(bufferId, list.slice(-MAX_MESSAGES_PER_BUFFER))

    if (bufferId !== this.state.activeBufferId) {
      const buffer = this.state.buffers.find((b) => b.id === bufferId)
      this.set({
        buffers: this.state.buffers.map((b) =>
          b.id === bufferId
            ? { ...b, unread: b.unread + 1, highlight: b.highlight || !!msg.isHighlight }
            : b
        )
      })
      // Channels only, matching the daemon's own rule for the seeded list: a
      // direct message is addressed to you in its entirety, so "mentioned"
      // adds nothing there, and it already has its own page and rail tile.
      //
      // Inside the not-the-open-buffer guard deliberately. A mention that
      // arrives in the conversation being read has been read, and badging an
      // inbox for it would ask someone to go and look at what is already in
      // front of them.
      if (msg.isHighlight && !msg.isOwn && buffer?.kind === 'channel') {
        this.set({ mentions: [msg, ...this.state.mentions].slice(0, MAX_MENTIONS) })
      }
    }
  }

  /**
   * Opens a buffer.
   *
   * `followGroup` moves the rail to wherever the buffer lives. That is right
   * for a selection arriving from outside the list - a notification click, a
   * freshly joined channel, the restored buffer at startup - which would
   * otherwise open something the sidebar isn't showing.
   *
   * It is wrong for a click on a row in the list, because that row is by
   * definition already on the page being shown. Following there dragged the
   * rail off the pinned and direct message pages onto whichever guild happened
   * to own the conversation, which is the opposite of what those pages are for.
   */
  async selectBuffer(bufferId: string, followGroup = true): Promise<void> {
    if (!this.state.buffers.some((b) => b.id === bufferId)) return

    // Snapshot the divider before clearing unread, so the "New messages" line
    // lands where the user actually left off rather than at the bottom.
    const buffer = this.state.buffers.find((b) => b.id === bufferId)!
    const dividerTs = this.state.dividerTsByBuffer[bufferId]
    const patch: Partial<ChatState> = {
      activeBufferId: bufferId,
      activePanel: '',
      replyingTo: null,
      buffers: this.state.buffers.map((b) =>
        b.id === bufferId ? { ...b, unread: 0, highlight: false } : b
      )
    }
    if (dividerTs === undefined && buffer.unread > 0) {
      const list = this.state.messagesByBuffer[bufferId] || []
      const firstUnread = list.length >= buffer.unread ? list[list.length - buffer.unread] : list[0]
      patch.dividerTsByBuffer = {
        ...this.state.dividerTsByBuffer,
        [bufferId]: firstUnread ? firstUnread.ts - 1 : 0
      }
    }
    this.set(patch)

    void window.moho.prefs.set('ui.activeBufferId', bufferId)
    if (followGroup) {
      const buffer = this.state.buffers.find((b) => b.id === bufferId)
      // A direct message's home group is the per-account one nobilis reports,
      // which the rail folds away in favour of the single cross-service page.
      // Selecting the folded id would land on a group with no tile, and the
      // pane falls back to the first entry - which is how a Discord DM opened
      // an unrelated guild.
      const group = buffer && isDirectMessage(buffer) ? DM_GROUP_ID : buffer?.groupId
      if (group && group !== this.state.activeGroupId) this.selectGroup(group)
    }
    void window.moho.markBufferRead(bufferId)
    bestEffort(this.markRead(bufferId), 'mark read')
    // And tell the service, where the service has anywhere to put it, so a
    // conversation read here stops being unread on somebody's phone. A no-op
    // on protocols with no read state, so it needs no test of which this is.
    bestEffort(window.moho.rpc('markBufferRead', { bufferId }), 'ack read')
    bestEffort(window.moho.rpc('subscribe', { bufferId }), `subscribe ${bufferId}`)

    // Discord only sends a member list for the channel being looked at, and
    // answers per guild rather than per channel - so this is asked for on
    // open, one channel at a time, rather than for everything subscribed.
    bestEffort(window.moho.rpc('requestMemberList', { bufferId }), 'member list')

    if (!this.state.loadedBuffers[bufferId]) await this.loadBacklog(bufferId)
    void this.refreshMatrixPermissions(bufferId)

    const service = this.accountFor(bufferId)?.service
    if (service === 'sockchat') void this.fetchSmilies()
    if (service === 'discord') void this.fetchBufferEmoji(bufferId)
  }

  /**
   * nobilis returns a bare filename per smiley - the table is bundled with the
   * client, not fetched from the site, so resolving it against our own
   * resource directory is the client's job. Fetched once per session.
   */
  private smiliesFetched = false

  private async fetchSmilies(): Promise<void> {
    if (this.smiliesFetched) return
    this.smiliesFetched = true
    try {
      const [rows, dir] = await Promise.all([
        window.moho.rpc<SockchatSmilie[]>('listSockchatSmilies'),
        window.moho.smiliesDir()
      ])
      const smilies: SmilieEntry[] = rows.map((s) => ({
        ...s,
        url: resolveMediaUrl(`${dir}/${s.file}`)
      }))
      this.set({ smilies, smilieIndex: buildSmilieIndex(smilies) })
    } catch (e) {
      // Non-fatal: shortcodes just stay as plain text.
      console.warn('[smilies] fetch failed:', (e as Error).message)
      this.smiliesFetched = false
    }
  }

  private async fetchBufferEmoji(bufferId: string): Promise<void> {
    if (this.state.bufferEmoji[bufferId]) return
    try {
      const emoji = await window.moho.rpc<CustomEmoji[]>('listBufferEmoji', { bufferId })
      this.set({ bufferEmoji: { ...this.state.bufferEmoji, [bufferId]: emoji } })
    } catch {
      /* a guild with no custom emoji, or a buffer nobilis has no emoji for */
    }
  }

  /**
   * Asks nobilis to re-sign a Discord message's attachment links, which it
   * does by fetching the message again. Resolves to the fresh attachments;
   * the store is updated by the messageUpdated the daemon broadcasts.
   */
  async refreshAttachments(bufferId: string, messageId: string): Promise<void> {
    await window.moho.rpc('refreshDiscordAttachments', { bufferId, messageId })
  }

  /**
   * Opens the real Discord message in a browser - the last resort when even
   * a refresh cannot produce a working link.
   */
  async openInDiscord(bufferId: string, messageId: string): Promise<void> {
    try {
      const { url } = await window.moho.rpc<{ url: string }>('getDiscordMessageLink', {
        bufferId,
        messageId
      })
      void window.moho.openExternal(url)
    } catch (e) {
      this.toast('error', (e as Error).message)
    }
  }

  /**
   * Marks everything in a set of buffers as read.
   *
   * One preference write rather than one per buffer: a folder can hold a
   * dozen servers with hundreds of channels between them, and writing the
   * file that many times would be slow and would leave it half-updated if
   * anything failed midway.
   */
  async markBuffersRead(bufferIds: string[]): Promise<void> {
    if (bufferIds.length === 0) return
    const now = Math.floor(Date.now() / 1000)
    try {
      const prefs = await window.moho.prefs.getAll()
      const lastReadTs = { ...((prefs.lastReadTs as Record<string, number>) || {}) }
      for (const id of bufferIds) {
        lastReadTs[id] = now
        void window.moho.markBufferRead(id)
      }
      void window.moho.prefs.set('lastReadTs', lastReadTs)
      this.set({ lastReadTs })
      // The counters are this client's own tally, so they have to be cleared
      // here too - the stored timestamp only decides what counts next time.
      this.set({
        buffers: this.state.buffers.map((b) =>
          bufferIds.includes(b.id) ? { ...b, unread: 0, highlight: false } : b
        )
      })
    } catch (e) {
      this.toast('error', `Couldn't mark as read: ${(e as Error).message}`)
    }
  }

  /**
   * What this account is called in this conversation, for a message being
   * sent before the service has said anything about it.
   *
   * Read from the last message you sent here rather than from the account's
   * display name, because those are not the same string and the difference
   * shows. An IRC account with no display name set reports its own id -
   * "nick@irc.example.org" - while the daemon records what you say under the
   * bare nick, so the echo was labelled with one and its replacement with the
   * other. It also broke grouping, since that compares author names: the
   * message you just sent would not group with the one before it, and then
   * would the moment it landed.
   *
   * The display name is the fallback for the first thing ever said in a
   * buffer, where there is nothing to copy.
   */
  private ownNameIn(bufferId: string): string {
    const list = this.state.messagesByBuffer[bufferId] || []
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].isOwn && !list[i].pending && list[i].from) return list[i].from
    }
    return this.accountFor(bufferId)?.displayName || 'me'
  }

  private async markRead(bufferId: string): Promise<void> {
    const prefs = await window.moho.prefs.getAll()
    const lastReadTs = { ...((prefs.lastReadTs as Record<string, number>) || {}) }
    lastReadTs[bufferId] = Math.floor(Date.now() / 1000)
    void window.moho.prefs.set('lastReadTs', lastReadTs)
    this.set({ lastReadTs })
  }

  private async loadBacklog(bufferId: string): Promise<void> {
    try {
      const rows = await window.moho.rpc<Message[]>('getBacklog', { bufferId, before: 0, limit: BACKLOG_PAGE })
      const live = this.state.messagesByBuffer[bufferId] || []
      // Anything that arrived live while this fetch was in flight must survive
      // it - merge by id rather than replacing wholesale.
      const seen = new Set(rows.map((r) => r.id))
      const merged = [...rows, ...live.filter((m) => !seen.has(m.id))] as ChatMessage[]
      merged.sort((a, b) => a.ts - b.ts)
      this.setMessages(bufferId, merged.slice(-MAX_MESSAGES_PER_BUFFER))
      this.set({ loadedBuffers: { ...this.state.loadedBuffers, [bufferId]: true } })
    } catch (e) {
      this.toast('error', `Couldn't load history: ${(e as Error).message}`)
    }
  }

  /**
   * Loads backwards until a particular message is on screen.
   *
   * Search reads the whole stored conversation while the view holds only the
   * most recent slice of it, so a result from last month used to be findable
   * and unreachable at once - which raises the fair question of why it was
   * offered as a result at all.
   *
   * Paging backwards rather than fetching a window around the message: it
   * reuses the load-more path exactly, including the part that holds the
   * reading position while older messages are prepended, and for Discord that
   * same path pulls further history from the server, so a result older than
   * anything stored locally is still reachable. Bounded, because a message
   * that is genuinely thousands back is better refused than chased forever.
   *
   * Returns whether it got there.
   */
  async jumpToMessage(bufferId: string, messageId: string): Promise<boolean> {
    const loaded = (): boolean =>
      (this.state.messagesByBuffer[bufferId] || []).some((m) => m.id === messageId)
    if (loaded()) return true

    for (let page = 0; page < 12; page++) {
      const before = (this.state.messagesByBuffer[bufferId] || []).length
      await this.loadMoreHistory(bufferId)
      if (loaded()) return true
      // Nothing came back, so there is nothing older to find it in.
      if ((this.state.messagesByBuffer[bufferId] || []).length === before) return false
    }
    return loaded()
  }

  async loadMoreHistory(bufferId: string): Promise<void> {
    if (this.state.loadingMore[bufferId]) return
    const list = this.state.messagesByBuffer[bufferId] || []
    const oldest = list.find((m) => !m.pending)
    if (!oldest) return

    this.set({ loadingMore: { ...this.state.loadingMore, [bufferId]: true } })
    try {
      const rows = await window.moho.rpc<Message[]>('getBacklog', {
        bufferId,
        before: oldest.ts,
        limit: BACKLOG_PAGE
      })
      if (rows.length) {
        const current = this.state.messagesByBuffer[bufferId] || []
        const seen = new Set(current.map((m) => m.id))
        const older = rows.filter((r) => !seen.has(r.id)) as ChatMessage[]
        this.setMessages(bufferId, [...older, ...current])
      }
    } catch (e) {
      this.toast('error', `Couldn't load older messages: ${(e as Error).message}`)
    } finally {
      const loadingMore = { ...this.state.loadingMore }
      delete loadingMore[bufferId]
      this.set({ loadingMore })
    }
  }

  // --- sending --------------------------------------------------------

  /**
   * Optimistic local echo, the way Discord's own client does it: the message
   * appears dimmed the instant the user hits send, keyed by a client-generated
   * id since nobilis hasn't assigned a real one yet. It stays that way until
   * either the real "message" event echoes it back (reconcileOwnEcho) or the
   * timeout sweep gives up on it.
   */
  async sendMessage(bufferId: string, body: string, attachmentPath?: string): Promise<void> {
    // A fresh send takes its reply target from the composer, and consumes it.
    const reply = this.state.replyingTo
    this.set({ replyingTo: null })
    return this.dispatchSend(bufferId, body, reply, attachmentPath)
  }

  /**
   * The actual send, with everything it needs passed in rather than read from
   * current state.
   *
   * That distinction is the whole point: a retry happens some time after the
   * failure, by which point the composer's reply target has been cleared - and
   * may have been replaced by a different one. Reading it live meant a retried
   * message lost its reply, or worse, silently acquired someone else's.
   */
  private async dispatchSend(
    bufferId: string,
    body: string,
    reply: { id: string; from: string; body: string } | null,
    attachmentPath?: string
  ): Promise<void> {
    if (!body.trim() && !attachmentPath) return
    const replyToId = reply?.id
    const clientId = `pending-${++this.sendSeq}-${Date.now()}`
    const account = this.accountFor(bufferId)

    const echo: ChatMessage = {
      id: clientId,
      bufferId,
      from: this.ownNameIn(bufferId),
      body,
      ts: Math.floor(Date.now() / 1000),
      isAction: false,
      isHighlight: false,
      // A real chat kind, and not the "privmsg" this used to invent: nothing
      // anywhere produces that word, so isChatKind rejected it and every
      // message being sent was drawn as a system line - no avatar column, an
      // italic grey body, never grouped, and in bubbles mode on the wrong
      // side of the pane. It then jumped into place the moment the daemon's
      // own copy replaced it.
      //
      // "chat" and "message" are the two spellings the backends use and the
      // renderer treats them alike, so either does; this is not claiming to
      // be the one this account's service will send.
      kind: 'chat',
      isOwn: true,
      // Your own face, so the picture is there from the first frame rather
      // than a coloured initial that swaps to a photograph on arrival.
      ...(account?.avatarUrl ? { avatarUrl: account.avatarUrl } : {}),
      pending: true,
      pendingBody: body,
      pendingReplyTo: replyToId,
      pendingAttachment: attachmentPath,
      ...(reply ? { replyTo: reply } : {})
    }
    // Warn before the message rather than after it. On IRC a message to
    // somebody who is not connected is accepted by the server and thrown
    // away - there is no bounce, no queue and no delivery later - so without
    // saying so the conversation looks like it worked.
    const warning = this.undeliverableNotice(bufferId)
    if (warning) this.appendMessage(bufferId, warning)

    this.appendMessage(bufferId, echo)
    this.pendingSends.set(clientId, { bufferId, ts: Date.now() })

    try {
      await window.moho.rpc('sendMessage', {
        bufferId,
        body,
        // Where a file goes on a service that cannot carry one. Read at send
        // time rather than held in state: it is a preference somebody may
        // change between one message and the next, and the daemon falls back
        // to its own default if this is absent or unknown to it.
        ...(attachmentPath
          ? { attachmentPath, uploadHost: await uploadHost(account?.service, attachmentPath) }
          : {}),
        ...(replyToId ? { replyToId } : {})
      })
      // Success alone doesn't resolve the echo - only the real message event
      // does, since that's what carries nobilis's own id and timestamp.
    } catch (e) {
      this.markSendFailed(clientId, (e as Error).message)
    }
  }

  /**
   * A note that what is about to be sent will not arrive, or nothing.
   *
   * Only where the protocol genuinely discards it. Discord and Matrix hold a
   * message for someone who is offline and deliver it when they return, so
   * warning there would be false; IRC does not, and Sneedchat's rooms are not
   * conversations that can be missed in this way.
   */
  private undeliverableNotice(bufferId: string): ChatMessage | null {
    const buffer = this.state.buffers.find((b) => b.id === bufferId)
    const account = this.accountFor(bufferId)
    if (!buffer || buffer.kind !== 'dm' || account?.service !== 'irc') return null

    const roster = this.state.presenceByBuffer[bufferId]
    // Absent presence is not evidence of absence: say nothing until the poll
    // has actually answered for this person.
    if (roster?.length !== 1 || roster[0].status !== 'offline') return null

    return {
      id: `notice-${++this.sendSeq}-${Date.now()}`,
      bufferId,
      from: '',
      body: `${buffer.name} is offline and will not receive this message.`,
      ts: Math.floor(Date.now() / 1000),
      isAction: false,
      isHighlight: false,
      kind: 'notice',
      isOwn: false
    }
  }

  /**
   * Matches an inbound own-message against an outstanding optimistic echo by
   * body, replacing it in place. Returns true when it consumed one, so the
   * caller knows not to also append the message as new.
   */
  private reconcileOwnEcho(real: Message): boolean {
    for (const [clientId, info] of this.pendingSends) {
      if (info.bufferId !== real.bufferId) continue
      const list = this.state.messagesByBuffer[info.bufferId] || []
      const echo = list.find((m) => m.id === clientId)
      if (!echo || !echoMatches(echo, real)) continue
      this.pendingSends.delete(clientId)
      this.setMessages(
        info.bufferId,
        list.map((m) => (m.id === clientId ? (real as ChatMessage) : m))
      )
      return true
    }
    return false
  }

  private markSendFailed(clientId: string, errorText: string): void {
    const info = this.pendingSends.get(clientId)
    if (!info) return
    // Kept in pendingSends deliberately: a late echo can still resolve an
    // already-failed row rather than leaving a permanent phantom failure.
    this.mapMessage(info.bufferId, clientId, (m) => ({
      ...m,
      pending: false,
      failed: true,
      errorText
    }))
  }

  private sweepPendingSends(): void {
    const now = Date.now()
    for (const [clientId, info] of this.pendingSends) {
      if (now - info.ts < SEND_TIMEOUT_MS) continue
      const list = this.state.messagesByBuffer[info.bufferId] || []
      const echo = list.find((m) => m.id === clientId)
      if (echo?.pending) this.markSendFailed(clientId, 'timed out')
    }
  }

  retrySend(clientId: string): void {
    const info = this.pendingSends.get(clientId)
    if (!info) return
    const list = this.state.messagesByBuffer[info.bufferId] || []
    const echo = list.find((m) => m.id === clientId)
    if (!echo) return
    this.pendingSends.delete(clientId)
    this.setMessages(info.bufferId, list.filter((m) => m.id !== clientId))
    // Resend exactly what was sent: the original reply target and file, not
    // whatever the composer happens to hold now.
    void this.dispatchSend(
      info.bufferId,
      echo.pendingBody || echo.body,
      echo.replyTo ?? null,
      echo.pendingAttachment
    )
  }

  async editMessage(bufferId: string, messageId: string, body: string): Promise<void> {
    try {
      await window.moho.rpc('editMessage', { bufferId, messageId, body })
    } catch (e) {
      this.toast('error', `Edit failed: ${(e as Error).message}`)
    }
  }

  async deleteMessage(bufferId: string, messageId: string): Promise<void> {
    try {
      await window.moho.rpc('deleteMessage', { bufferId, messageId })
    } catch (e) {
      this.toast('error', `Delete failed: ${(e as Error).message}`)
    }
  }

  /**
   * Reacting, shown immediately rather than when the service agrees.
   *
   * The pill used to change only when the gateway echoed the reaction back,
   * which made a click on a reaction-role message look like it had done
   * nothing at all: those bots take the reaction off again the moment they
   * grant the role, so the add and the removal both arrive and the row ends
   * up exactly as it started. People click again, and again.
   *
   * Showing it at once separates "this did not register" from "this
   * happened and was undone by somebody else" - and a failure puts the row
   * back, so an optimistic view never outlives being wrong.
   */
  async toggleReaction(bufferId: string, messageId: string, emoji: string, add: boolean): Promise<void> {
    const before = this.state.messagesByBuffer[bufferId]?.find((m) => m.id === messageId)?.reactions
    this.mapMessage(bufferId, messageId, (m) => ({
      ...m,
      reactions: applyOwnReaction(m.reactions ?? [], emoji, add)
    }))
    try {
      await window.moho.rpc('toggleReaction', { bufferId, messageId, emoji, add })
    } catch (e) {
      this.mapMessage(bufferId, messageId, (m) => ({ ...m, reactions: before }))
      this.toast('error', (e as Error).message)
    }
  }

  // --- misc -----------------------------------------------------------

  accountFor(bufferId: string): Account | undefined {
    const buffer = this.state.buffers.find((b) => b.id === bufferId)
    return buffer && this.state.accounts.find((a) => a.id === buffer.accountId)
  }

  setActivePanel(panel: ActivePanel, joinPanelAccountId = ''): void {
    this.set({ activePanel: panel, joinPanelAccountId })
  }

  startReply(id: string, from: string, body: string): void {
    this.set({ replyingTo: { id, from, body } })
  }

  cancelReply(): void {
    this.set({ replyingTo: null })
  }

  /**
   * Matrix rooms only, fetched once per buffer. Permissions rarely change
   * mid-session, and a stale cache is only ever advisory - the homeserver
   * still validates the action regardless of what's cached here.
   */
  private async refreshMatrixPermissions(bufferId: string): Promise<void> {
    if (this.state.matrixPermissions[bufferId]) return
    const account = this.accountFor(bufferId)
    if (account?.service !== 'matrix') return
    try {
      const perms = await window.moho.rpc<RoomPermissions>('getMatrixRoomPermissions', {
        accountId: account.id,
        bufferId
      })
      this.set({ matrixPermissions: { ...this.state.matrixPermissions, [bufferId]: perms } })
    } catch {
      /* advisory only - a failure just means no moderation actions are offered */
    }
  }

  async closeBuffer(bufferId: string): Promise<void> {
    try {
      await window.moho.rpc('partBuffer', { bufferId })
      if (this.state.activeBufferId === bufferId) this.set({ activeBufferId: '' })
    } catch (e) {
      this.toast('error', (e as Error).message)
    }
  }

  toast(kind: 'info' | 'error', text: string): void {
    const id = ++this.toastSeq
    this.set({ toasts: [...this.state.toasts, { id, kind, text }] })
    setTimeout(() => {
      this.set({ toasts: this.state.toasts.filter((t) => t.id !== id) })
    }, 6000)
  }

  dismissToast(id: number): void {
    this.set({ toasts: this.state.toasts.filter((t) => t.id !== id) })
  }

  setDiscordLoginStatus(status: string): void {
    this.set({ discordLoginStatus: status, discordQrPath: '' })
  }

  /** Begin (or clear) a re-authentication of an existing Discord account. */
  setDiscordReauth(accountId: string): void {
    this.set({
      discordReauthAccountId: accountId,
      discordQrPath: '',
      discordLoginStatus: '',
      discordMfa: null
    })
  }

  clearDiscordMfa(): void {
    this.set({ discordMfa: null })
  }
  setSockChatLoginStatus(status: string): void {
    this.set({ sockChatLoginStatus: status })
  }
  setMatrixLoginStatus(status: string): void {
    this.set({ matrixLoginStatus: status })
  }
}

export const store = new ChatStore()
