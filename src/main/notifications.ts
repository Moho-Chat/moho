import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Notification, nativeImage } from 'electron'
import type { WebContents } from 'electron'
import type { Prefs } from './prefs'
import type { Buffer as ChatBuffer } from '../shared/wire'

/**
 * Desktop notifications plus the unread/pinned-alert bookkeeping that drives
 * the tray.
 *
 * This lives in main rather than the renderer deliberately: it has to stay
 * accurate while the window is closed, which is the whole point of a tray
 * alert. nobilis only emits "notification" for an inbound DM or a highlighted
 * mention (never plain traffic - see nobilis/src/runtime.rs's record_message),
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
  /** Mirror of nobilis's buffer list, for resolving an account's server buffer. */
  private buffers = new Map<string, ChatBuffer>()
  private avatarFetchInFlight = false
  private avatarSeq = 0

  /** Source path -> transcoded PNG, so a repeat sender is converted once. */
  private transcoded = new Map<string, string>()
  /** Accounts currently set to Do Not Disturb. */
  private dndAccounts = new Set<string>()

  constructor(
    private prefs: Prefs,
    private onAlertChange: (unreadCount: number, hasPinnedAlert: boolean) => void,
    private onActivate: (bufferId: string) => void,
    /** The renderer, borrowed only to decode formats nativeImage cannot. */
    private renderer: () => WebContents | null = () => null
  ) {}

  /** Mirrors each account's status, so DND can be enforced here. */
  trackAccounts(accounts: { id: string; status?: string }[]): void {
    this.dndAccounts = new Set(accounts.filter((a) => a.status === 'dnd').map((a) => a.id))
  }

  trackBuffer(buffer: ChatBuffer, removed: boolean): void {
    if (removed) this.buffers.delete(buffer.id)
    else this.buffers.set(buffer.id, buffer)
  }

  /**
   * Mute is hierarchical: muting a server buffer suppresses notifications for
   * every channel under that account, matching how muting an entire IRC
   * network is normally all-or-nothing. Deliberately two-level, not a
   * three-state inherit/override system - to restore notifications under a
   * muted server, unmute the server itself.
   *
   * Direct messages are exempt, and a hidden server buffer does not cascade at
   * all; see isMuted for why.
   */
  private isMuted(accountId: string, bufferId: string): boolean {
    // Do Not Disturb is a statement about the person rather than any one
    // connection, so it silences every account regardless of which one it was
    // set from. Held in main so it keeps working with the window closed,
    // which is the whole point of the setting.
    if (this.dndAccounts.size > 0) return true

    const muted = this.prefs.get<string[]>('mutedBuffers', [])
    if (muted.includes(bufferId)) return true

    // A server, guild or space muted from its rail tile silences everything
    // under it, direct messages included - unlike the server-buffer cascade
    // below, this one was set deliberately on that exact group.
    const group = this.buffers.get(bufferId)?.groupId
    if (group && this.prefs.get<string[]>('mutedGroups', []).includes(group)) return true

    // A direct message is a person addressing you, not channel traffic:
    // silencing a network should not silence someone messaging you on it.
    // This is where that mattered most - a muted IRC network swallowed the
    // desktop notification for an incoming query.
    if (this.buffers.get(bufferId)?.kind === 'dm') return false

    const server = [...this.buffers.values()].find(
      (b) => b.accountId === accountId && b.kind === 'server'
    )
    if (!server || !muted.includes(server.id)) return false

    // Only inherit from a server buffer the user can still reach. A hidden one
    // has no row in the list, so its mute toggle is unreachable and the
    // cascade would be impossible to undo.
    return !this.prefs.get<string[]>('hiddenBuffers', []).includes(server.id)
  }

  async handle(payload: NotificationPayload): Promise<void> {
    if (this.isMuted(payload.accountId, payload.bufferId)) return

    if (!this.unread.has(payload.bufferId)) {
      this.unread.add(payload.bufferId)
      this.publish()
    }

    if (!Notification.isSupported()) return

    const icon = await this.notificationIcon(payload.avatarUrl)
    const notification = new Notification({
      title: payload.title || 'moho',
      body: payload.body || '',
      ...(icon ? { icon } : {})
    })
    notification.on('click', () => this.onActivate(payload.bufferId))
    notification.show()
  }

  /**
   * A file path the notification daemon will actually display, or null.
   *
   * Electron renders a notification icon through nativeImage, which only
   * decodes PNG and JPEG. That is a real constraint here rather than a
   * theoretical one: Sneedchat serves avatars as WebP and GIF (and names them
   * .jpg), and Matrix serves whatever the uploader sent, so on those services
   * the icon silently came out empty while Discord's PNGs worked - which is
   * exactly the "only Discord has avatars" symptom.
   *
   * Chromium itself decodes all of those, so anything nativeImage rejects is
   * handed to the renderer to be redrawn as a PNG.
   */
  private async notificationIcon(url?: string): Promise<string | null> {
    const file = await this.fetchAvatar(url)
    if (!file) return null
    if (!nativeImage.createFromPath(file).isEmpty()) return file

    const cached = this.transcoded.get(file)
    if (cached && fs.existsSync(cached)) return cached
    const png = await this.transcodeToPng(file)
    if (png) this.transcoded.set(file, png)
    return png
  }

  /**
   * Redraws an image the main process cannot decode into a PNG it can, using
   * the window's own renderer - Chromium reads WebP, GIF and the rest natively.
   *
   * The window is hidden rather than destroyed when closed, so its renderer is
   * alive whenever the app is, which is what makes this safe to rely on for
   * notifications that fire with no window on screen. If it ever isn't there,
   * this returns null and the notification simply goes out without an icon.
   */
  private async transcodeToPng(file: string): Promise<string | null> {
    const wc = this.renderer()
    if (!wc || wc.isDestroyed()) return null
    try {
      const src = `moho-media://file/?p=${encodeURIComponent(file)}`
      const dataUrl: string | null = await wc.executeJavaScript(
        `(async () => {
           try {
             const res = await fetch(${JSON.stringify(src)})
             if (!res.ok) return null
             const bmp = await createImageBitmap(await res.blob())
             // Notification icons are displayed small; capping keeps an
             // animated GIF's first frame from becoming a huge PNG.
             const scale = Math.min(1, 128 / Math.max(bmp.width, bmp.height))
             const c = document.createElement('canvas')
             c.width = Math.max(1, Math.round(bmp.width * scale))
             c.height = Math.max(1, Math.round(bmp.height * scale))
             c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
             return c.toDataURL('image/png')
           } catch { return null }
         })()`,
        true
      )
      if (!dataUrl?.startsWith('data:image/png;base64,')) return null
      const out = path.join(os.tmpdir(), `moho-notify-icon-${++this.avatarSeq}.png`)
      fs.writeFileSync(out, global.Buffer.from(dataUrl.split(',')[1], 'base64'))
      return out
    } catch {
      return null
    }
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
