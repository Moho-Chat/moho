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
  'display.messageMode': 'classic',
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
