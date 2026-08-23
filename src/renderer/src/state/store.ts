import type {
  Account,
  Buffer as WireBuffer,
  NobilisEvent,
  CustomEmoji,
  Member,
  Message,
  BufferGroup,
  MatrixVerification,
  RoomPermissions,
  SockchatSmilie,
  AudioDevice,
  VoicePrefs,
  VoiceChannel,
  VoiceSession
} from '../../../shared/wire'
import { buildSmilieIndex, type SmilieEntry, type SmilieIndex } from '../lib/format'
import { resolveMediaUrl } from '../lib/util'
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
  linkUp: boolean
  accounts: Account[]
  buffers: BufferEntry[]
  /** Rail entries - guilds, spaces, DM collections and account entries. */
  groups: BufferGroup[]
  /** Which rail entry the channel pane is showing. */
  activeGroupId: string
  /** Sound devices and whether voice is silenced, as the daemon sees them. */
  voicePrefs: VoicePrefs
  audioDevices: AudioDevice[]
  /** The selected guild's voice channels, and who is in each. */
  voiceChannels: VoiceChannel[]
  /** Which guild `voiceChannels` describes, so a stale update is ignorable. */
  voiceGuildId: string
  /** Live voice connections, so the pane can show what you are in. */
  voiceSessions: VoiceSession[]
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
  voicePrefs: { micMuted: false, deafened: false },
  audioDevices: [],
  voiceChannels: [],
  voiceGuildId: '',
  voiceSessions: [],
  activeBufferId: '',
  activePanel: '',
  joinPanelAccountId: '',
  messagesByBuffer: {},
  presenceByBuffer: {},
  loadedBuffers: {},
  loadingMore: {},
  dividerTsByBuffer: {},
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
function bestEffort(work: Promise<unknown>, what: string): void {
  void work.catch((e: Error) => console.debug(`[moho] ${what}:`, e.message))
}

/**
 * Scrollback kept in memory per buffer. Older messages stay in nobilis's SQLite
 * store and come back through getBacklog when the user scrolls up, so this cap
 * bounds memory without losing history.
 */
const MAX_MESSAGES_PER_BUFFER = 500
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
  }

  private async refreshAll(): Promise<void> {
    await Promise.all([this.refreshAccounts(), this.refreshBuffers(), this.refreshGroups(), this.refreshVoicePrefs()])
    if (this.state.activeBufferId) await this.selectBuffer(this.state.activeBufferId)
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

  async leaveVoice(accountId: string): Promise<void> {
    try {
      await window.moho.rpc('leaveVoiceChannel', { accountId })
      await this.refreshVoiceSessions()
    } catch (e) {
      this.toast('error', `Couldn't leave voice: ${(e as Error).message}`)
    }
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

      case 'bufferGroupChange':
        this.upsertGroup(data as BufferGroup)
        break

      // Somebody joined or left a voice channel in a guild we may be showing.
      case 'voiceMembershipChanged':
        if (data.guildId === this.state.voiceGuildId) {
          void this.refreshVoiceChannels(data.accountId, data.guildId)
        }
        void this.refreshVoiceSessions()
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
        if (!data.error) void this.refreshAccounts()
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
        if (!data.error) void this.refreshAccounts()
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
  }

  private handleConnectionState(data: { accountId: string; state: string; error?: string }): void {
    const { accounts } = this.state
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

  private setMessages(bufferId: string, list: ChatMessage[]): void {
    this.set({ messagesByBuffer: { ...this.state.messagesByBuffer, [bufferId]: list } })
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
      this.set({
        buffers: this.state.buffers.map((b) =>
          b.id === bufferId
            ? { ...b, unread: b.unread + 1, highlight: b.highlight || !!msg.isHighlight }
            : b
        )
      })
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

  private async markRead(bufferId: string): Promise<void> {
    const prefs = await window.moho.prefs.getAll()
    const lastReadTs = { ...((prefs.lastReadTs as Record<string, number>) || {}) }
    lastReadTs[bufferId] = Math.floor(Date.now() / 1000)
    void window.moho.prefs.set('lastReadTs', lastReadTs)
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
      from: account?.displayName || 'me',
      body,
      ts: Math.floor(Date.now() / 1000),
      isAction: false,
      isHighlight: false,
      kind: 'privmsg',
      isOwn: true,
      pending: true,
      pendingBody: body,
      pendingReplyTo: replyToId,
      pendingAttachment: attachmentPath,
      ...(reply ? { replyTo: reply } : {})
    }
    this.appendMessage(bufferId, echo)
    this.pendingSends.set(clientId, { bufferId, ts: Date.now() })

    try {
      await window.moho.rpc('sendMessage', {
        bufferId,
        body,
        ...(attachmentPath ? { attachmentPath } : {}),
        ...(replyToId ? { replyToId } : {})
      })
      // Success alone doesn't resolve the echo - only the real message event
      // does, since that's what carries nobilis's own id and timestamp.
    } catch (e) {
      this.markSendFailed(clientId, (e as Error).message)
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
      if (!echo || echo.pendingBody !== real.body) continue
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

  async toggleReaction(bufferId: string, messageId: string, emoji: string, add: boolean): Promise<void> {
    try {
      await window.moho.rpc('toggleReaction', { bufferId, messageId, emoji, add })
    } catch (e) {
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
