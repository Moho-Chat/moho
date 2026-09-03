import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { app } from 'electron'
import { log } from './log'

/**
 * Durable UI preferences - the replacement for DMS's per-plugin data store.
 * Flat dotted string keys, kept identical to the ones the QML frontend used so
 * the mapping between the two stays legible.
 *
 * Everything here is a pure display/notification preference the daemon has no
 * business knowing about (pins, mutes, collapse state, read markers) - account
 * and protocol config lives in nobilis's own accounts.toml instead.
 */

export const PREF_DEFAULTS: Record<string, unknown> = {
  'ui.activeBufferId': '',
  'ui.sidebarFolded': false,
  'ui.userListFolded': false,
  pinnedBuffers: [],
  pinnedCollapsed: false,
  mutedBuffers: [],
  hiddenBuffers: [],
  collapsedAccounts: {},
  collapsedGuilds: {},
  discordGuildChannelLimits: {},
  blockedNicks: [],
  lastReadTs: {},
  'display.messageMode': 'comfy',
  'display.relativeTimestamps': false,
  'media.autoplay': true,
  'media.loop': true,
  'media.contentSniffing': true,
  'filters.showJoinPart': true,
  'filters.showTopic': true,
  'filters.showMode': true,
  'hotkey.toggle': 'Control+Shift+M'
}

export class Prefs extends EventEmitter {
  private data: Record<string, unknown> = {}
  private file: string
  private writeTimer: NodeJS.Timeout | null = null

  constructor() {
    super()
    this.file = path.join(app.getPath('userData'), 'prefs.json')
    this.load()
  }

  private load(): void {
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch {
      // Missing or corrupt: start from defaults rather than refusing to run.
      this.data = {}
    }
    this.renameSneedchat()
  }

  /**
   * Sneedchat account ids used to be spelled "sockchat:", after an
   * implementation of the protocol rather than after the chat itself.
   *
   * Almost everything in here is keyed by buffer id, and a buffer id is built
   * from the account id - so without this every pin, mute, category, read
   * marker and popout size for Sneedchat would point at conversations that no
   * longer exist under any name, and the rename would look like the client
   * quietly forgetting a year of arrangement.
   *
   * A blunt string rewrite over the whole file, because the ids appear as
   * keys, as values, and inside longer strings ("account:sockchat:name"), and
   * "sockchat" is not a word that occurs in this file for any other reason.
   */
  private renameSneedchat(): void {
    const before = JSON.stringify(this.data)
    if (!before.includes('sockchat')) return
    // Both spellings it appears in: an account id ends in a colon, and the
    // per-service upload host is keyed "uploads.sockchat.media".
    this.data = JSON.parse(
      before.replaceAll('sockchat:', 'sneedchat:').replaceAll('uploads.sockchat.', 'uploads.sneedchat.')
    )
    log.info('prefs: renamed sockchat: ids to sneedchat:')
    this.scheduleFlush()
  }

  /** Debounced - a burst of writes (scroll markers, collapse toggles) is one flush. */
  private scheduleFlush(): void {
    if (this.writeTimer) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true })
        fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2))
      } catch (e) {
        log.error('[prefs] write failed:', (e as Error).message)
      }
    }, 300)
  }

  get<T>(key: string, fallback?: T): T {
    if (key in this.data) return this.data[key] as T
    if (fallback !== undefined) return fallback
    return PREF_DEFAULTS[key] as T
  }

  set(key: string, value: unknown): void {
    this.data[key] = value
    this.scheduleFlush()
    this.emit('change', key, value)
  }

  all(): Record<string, unknown> {
    return { ...PREF_DEFAULTS, ...this.data }
  }

  flushNow(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2))
    } catch {
      /* best effort on the way out */
    }
  }
}
