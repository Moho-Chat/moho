import { beforeEach, describe, expect, it, vi } from 'vitest'

const shown: { silent?: boolean }[] = []
vi.mock('electron', () => {
  class Notification {
    static isSupported(): boolean {
      return true
    }
    opts: { silent?: boolean }
    constructor(opts: { silent?: boolean }) {
      this.opts = opts
    }
    on(): void {}
    show(): void {
      shown.push(this.opts)
    }
  }
  return { Notification, nativeImage: {}, app: { getPath: () => '/tmp' } }
})

import { Notifier } from './notifications'
import type { TrayState } from './tray'

const payload = { accountId: 'a', bufferId: 'b', title: 'alice', body: 'hi' }

function notifier(settings: Record<string, unknown>): { n: Notifier; alerts: TrayState[] } {
  const alerts: TrayState[] = []
  const prefs = { get: <T>(key: string, fallback: T): T => (key in settings ? (settings[key] as T) : fallback) }
  const n = new Notifier(prefs as never, (state) => alerts.push(state), () => {})
  return { n, alerts }
}

describe('notification settings', () => {
  beforeEach(() => {
    shown.length = 0
  })

  it('shows a notification, with the system sound, by default', async () => {
    await notifier({}).n.handle(payload)
    expect(shown).toHaveLength(1)
    expect(shown[0].silent).toBe(false)
  })

  it('shows none when desktop notifications are off, but still counts the conversation as unread', async () => {
    const { n, alerts } = notifier({ 'notifications.desktop': false })
    await n.handle(payload)
    expect(shown).toHaveLength(0)
    expect(alerts.at(-1)?.unread).toBe(1)
  })

  it('makes them silent when the sound is off', async () => {
    await notifier({ 'notifications.sound': false }).n.handle(payload)
    expect(shown[0].silent).toBe(true)
  })
})

describe('what the tray is told is waiting', () => {
  const buffer = (id: string, kind: string): never => ({ id, kind }) as never

  it('counts direct messages and mentions apart, and lights for both', async () => {
    const { n, alerts } = notifier({ 'notifications.desktop': false })
    n.trackBuffer(buffer('dm', 'dm'), false)
    n.trackBuffer(buffer('chan', 'channel'), false)
    await n.handle({ ...payload, bufferId: 'dm' })
    await n.handle({ ...payload, bufferId: 'chan' })
    expect(alerts.at(-1)).toEqual({ unread: 2, dms: 1, mentions: 1 })
  })

  it('names the newest waiting conversation, and none once they are read', async () => {
    const { n } = notifier({ 'notifications.desktop': false })
    expect(n.latestUnread()).toBeNull()
    await n.handle({ ...payload, bufferId: 'first' })
    await n.handle({ ...payload, bufferId: 'second' })
    expect(n.latestUnread()).toBe('second')
    n.clear('second')
    expect(n.latestUnread()).toBe('first')
    n.clearAll()
    expect(n.latestUnread()).toBeNull()
  })
})
