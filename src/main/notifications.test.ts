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

const payload = { accountId: 'a', bufferId: 'b', title: 'alice', body: 'hi' }

function notifier(settings: Record<string, unknown>): { n: Notifier; alerts: [number, boolean][] } {
  const alerts: [number, boolean][] = []
  const prefs = { get: <T>(key: string, fallback: T): T => (key in settings ? (settings[key] as T) : fallback) }
  const n = new Notifier(prefs as never, (count, alert) => alerts.push([count, alert]), () => {})
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
    expect(alerts.at(-1)?.[0]).toBe(1)
  })

  it('makes them silent when the sound is off', async () => {
    await notifier({ 'notifications.sound': false }).n.handle(payload)
    expect(shown[0].silent).toBe(true)
  })
})
