import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Notification, nativeImage } from 'electron'
import type { WebContents } from 'electron'
import type { Prefs } from './prefs'
import type { Buffer as ChatBuffer } from '../shared/wire'

/**
 * Desktop notifications plus the unread/alert bookkeeping that drives
 * the tray.
 *
 * This lives in main rather than the renderer deliberately: it has to stay
 * accurate while the window is closed, which is the whole point of a tray
 * alert. nobilis only emits "notification" for an inbound DM or a highlighted
 * mention (never plain traffic - see nobilis/src/runtime.rs's record_message),
 * so this event stream is already the right granularity to count.
 */

/**
 * The most an avatar may weigh before this stops trying to draw it.
 *
 * The bytes cross into the renderer as base64 inside a script, so a file that
 * is not really an avatar would cost several times its own size to find that
 * out. Two megabytes is far more than any service's avatar and far less than
 * anything worth this.
 */
const MAX_ICON_BYTES = 2 * 1024 * 1024

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

  constructor(
    private prefs: Prefs,
    private onAlertChange: (unreadCount: number, hasAlert: boolean) => void,
    private onActivate: (bufferId: string) => void,
    /** The renderer, borrowed only to decode formats nativeImage cannot. */
    private renderer: () => WebContents | null = () => null,
    /**
     * Whether this conversation is on screen in a window of its own.
     *
     * Somebody who has popped a channel out is looking at it, which is what
     * popping it out was for - so an alert saying it has traffic is telling
     * them what they can already see, and a tray badge counting it as unread
     * is simply wrong.
     */
    private isWatched: (bufferId: string) => boolean = () => false
  ) {}

  trackBuffer(buffer: ChatBuffer, removed: boolean): void {
    if (removed) this.buffers.delete(buffer.id)
    else this.buffers.set(buffer.id, buffer)
  }

  /**
   * Muting a buffer silences that buffer, and muting a rail entry silences
   * everything under it. Nothing in between: a server buffer used to cascade
   * to every channel on its account, which made the one thing people actually
   * want to mute impossible to mute on its own.
   *
   * That thing is an IRC server buffer. A network talks continuously while it
   * connects - MOTD, notices, services - and some of it carries your nick, so
   * nobilis reports it as a highlight and a desktop notification fires. The
   * only cure was muting the server buffer, which then took every channel on
   * the network with it. Now it takes only itself, and silencing the whole
   * network is the rail tile's mute: one deliberate action, undoable from a
   * tile that is always on screen.
   *
   * Kept in step with the renderer's isMutedBuffer, which decides the same
   * question for the unread badges.
   */
  private isMuted(_accountId: string, bufferId: string): boolean {
    if (this.prefs.get<string[]>('mutedBuffers', []).includes(bufferId)) return true

    // A server, guild or space muted from its rail tile silences everything
    // under it, direct messages included.
    const group = this.buffers.get(bufferId)?.groupId
    return !!group && this.prefs.get<string[]>('mutedGroups', []).includes(group)
  }

  async handle(payload: NotificationPayload): Promise<void> {
    if (this.isMuted(payload.accountId, payload.bufferId)) return
    if (this.isWatched(payload.bufferId)) return

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
   * What an image actually is, from its first few bytes.
   *
   * Not from its name: Sneedchat serves WebP and GIF avatars called `.jpg`,
   * which is half the reason this transcode exists at all. A data URL's
   * declared type is the one the decoder is handed, so taking it from the
   * extension would hand it the wrong one for exactly the files that need
   * this path.
   */
  private imageTypeOf(bytes: Buffer): string {
    const starts = (...magic: number[]): boolean =>
      magic.every((byte, i) => bytes[i] === byte)
    if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png'
    if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
    if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif'
    // RIFF....WEBP
    if (starts(0x52, 0x49, 0x46, 0x46) && bytes.subarray(8, 12).toString() === 'WEBP') {
      return 'image/webp'
    }
    // Something else entirely. Chromium sniffs the bytes of an <img> either
    // way, so a wrong-but-plausible type still decodes what it can, and what
    // it cannot decode falls out of the null below rather than here.
    return 'image/png'
  }

  /**
   * Redraws an image the main process cannot decode into a PNG it can, using
   * the window's own renderer - Chromium reads WebP, GIF and the rest natively.
   *
   * The bytes travel to the renderer as a data URL rather than being fetched
   * back out of the media scheme. That is not a style preference: this used to
   * ask the renderer to `fetch("moho-media://...")`, and the window's policy
   * allows that scheme for images and media but not for `connect-src`, so the
   * fetch was refused every single time. The catch below swallowed it, the
   * function returned null, and the notification went out with no icon - which
   * is precisely the symptom this transcode was written to fix, on precisely
   * the services (Sneedchat, Matrix) whose avatars nativeImage cannot read.
   *
   * Widening the policy would have been the smaller diff and the worse answer.
   * The media scheme can also reach the daemon's config directory, where the
   * account tokens live; allowing `connect-src` there would turn "a script in
   * this window could ask for that file" into "a script in this window could
   * read it". Main already holds the path and may read it, so it hands over
   * the bytes and the policy stays as it is.
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
      const bytes = fs.readFileSync(file)
      // An avatar is kilobytes. Anything of a size worth base64-ing across
      // this boundary is not an avatar, and a notification icon is not worth
      // the memory of finding out.
      if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) return null
      const source = `data:${this.imageTypeOf(bytes)};base64,${bytes.toString('base64')}`
      const dataUrl: string | null = await wc.executeJavaScript(
        `(async () => {
           try {
             const img = new Image()
             img.src = ${JSON.stringify(source)}
             // decode() rather than onload: it settles after the pixels are
             // ready to draw, which is what the canvas is about to do.
             await img.decode()
             // Notification icons are displayed small; capping keeps an
             // animated GIF's first frame from becoming a huge PNG.
             const scale = Math.min(1, 128 / Math.max(img.width, img.height))
             const c = document.createElement('canvas')
             c.width = Math.max(1, Math.round(img.width * scale))
             c.height = Math.max(1, Math.round(img.height * scale))
             c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
             // A data: image does not taint the canvas, so this is readable.
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
   * Whether the tray should show something is waiting.
   *
   * A direct message counts, and this is the change: the tray used to light up
   * only for *pinned* buffers, on the reasoning that a DM had already had its
   * desktop notification and the tray was for things important enough to pin.
   * In practice that made the icon nearly inert - somebody messages you, and
   * the one place still on screen after the notification has faded says
   * nothing, unless you happened to have pinned that exact conversation.
   *
   * Pinned buffers still count, so a channel worth pinning can still raise it.
   * There is no count here: a tray icon is around 22 pixels, which is room for
   * "yes" and not for a number.
   */
  publish(): void {
    const pinned = this.prefs.get<string[]>('pinnedBuffers', [])
    const hasAlert = [...this.unread].some(
      (id) => this.buffers.get(id)?.kind === 'dm' || pinned.includes(id)
    )
    this.onAlertChange(this.unread.size, hasAlert)
  }
}
