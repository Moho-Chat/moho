import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Notification } from 'electron'
import type { Prefs } from './prefs'
import type { Buffer as ChatBuffer } from '../shared/wire'

/**
 * Desktop notifications plus the unread/pinned-alert bookkeeping that drives
 * the tray.
 *
 * This lives in main rather than the renderer deliberately: it has to stay
 * accurate while the window is closed, which is the whole point of a tray
 * alert. chatd only emits "notification" for an inbound DM or a highlighted
 * mention (never plain traffic - see chatd/src/runtime.rs's record_message),
 * so this event stream is already the right granularity to count.
 */

export interface NotificationPayload {
  accountId: string
  bufferId: string
  title?: string
  body?: string
  avatarUrl?: string
}

export class Notifier {
  /** Every bufferId holding an un-acknowledged DM/mention. */
  private unread = new Set<string>()
  /** Mirror of chatd's buffer list, for resolving an account's server buffer. */
  private buffers = new Map<string, ChatBuffer>()
  private avatarFetchInFlight = false
  private avatarSeq = 0

  constructor(
    private prefs: Prefs,
    private onAlertChange: (unreadCount: number, hasPinnedAlert: boolean) => void,
    private onActivate: (bufferId: string) => void
  ) {}

  trackBuffer(buffer: ChatBuffer, removed: boolean): void {
    if (removed) this.buffers.delete(buffer.id)
    else this.buffers.set(buffer.id, buffer)
  }

  /**
   * Mute is hierarchical: muting a server buffer suppresses notifications for
   * every channel/DM under that account, matching how muting an entire IRC
   * network is normally all-or-nothing. Deliberately two-level, not a
   * three-state inherit/override system - to restore notifications under a
   * muted server, unmute the server itself.
   */
  private isMuted(accountId: string, bufferId: string): boolean {
    const muted = this.prefs.get<string[]>('mutedBuffers', [])
    if (muted.includes(bufferId)) return true
    for (const buf of this.buffers.values()) {
      if (buf.accountId === accountId && buf.kind === 'server') return muted.includes(buf.id)
    }
    return false
  }

  async handle(payload: NotificationPayload): Promise<void> {
    if (this.isMuted(payload.accountId, payload.bufferId)) return

    if (!this.unread.has(payload.bufferId)) {
      this.unread.add(payload.bufferId)
      this.publish()
    }

    if (!Notification.isSupported()) return

    const icon = await this.fetchAvatar(payload.avatarUrl)
    const notification = new Notification({
      title: payload.title || 'moho',
      body: payload.body || '',
      ...(icon ? { icon } : {})
    })
    notification.on('click', () => this.onActivate(payload.bufferId))
    notification.show()
  }

  /**
   * Electron's Notification takes a local file path for its icon, not a URL,
   * so a remote avatar has to be fetched first. Falls back to no icon (rather
   * than queuing) when a fetch is already in flight - notifications are
   * infrequent enough that this only matters for two arriving within the same
   * couple hundred milliseconds, and a missing icon on one of them is a fine
   * trade for not building a real queue.
   */
  private async fetchAvatar(url?: string): Promise<string | null> {
    if (!url || this.avatarFetchInFlight) return null
    if (url.startsWith('file://')) return decodeURI(url.slice('file://'.length))
    if (!/^https?:\/\//i.test(url)) return null

    this.avatarFetchInFlight = true
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3000)
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timer)
      if (!res.ok) return null
      const ext = (url.split('?')[0].split('.').pop() || 'png').slice(0, 4)
      const file = path.join(os.tmpdir(), `moho-notify-avatar-${++this.avatarSeq}.${ext}`)
      fs.writeFileSync(file, global.Buffer.from(await res.arrayBuffer()))
      return file
    } catch {
      return null
    } finally {
      this.avatarFetchInFlight = false
    }
  }

  /** The user opened (and thereby read) a buffer. */
  clear(bufferId: string): void {
    if (this.unread.delete(bufferId)) this.publish()
  }

  clearAll(): void {
    if (this.unread.size === 0) return
    this.unread.clear()
    this.publish()
  }

  /**
   * Only *pinned* buffers escalate to the tray alert state. An unread DM or
   * mention on some ordinary buffer already got its own desktop notification;
   * the tray only lights up for buffers important enough to have been pinned.
   */
  publish(): void {
    const pinned = this.prefs.get<string[]>('pinnedBuffers', [])
    const hasPinnedAlert = [...this.unread].some((id) => pinned.includes(id))
    this.onAlertChange(this.unread.size, hasPinnedAlert)
  }
}
