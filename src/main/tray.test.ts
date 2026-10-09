import { describe, expect, it, vi } from 'vitest'
import { trayIconFile, trayMenu, trayTooltip, waitingSummary, NOTHING_WAITING, type TrayActions } from './tray'

const acts = (): TrayActions => ({
  toggleWindow: vi.fn(),
  openLatest: vi.fn(),
  openSettings: vi.fn(),
  setStatus: vi.fn(),
  restart: vi.fn(),
  quit: vi.fn()
})

describe('the tray icon', () => {
  it('is a light bubble on a dark system and a dark one on a light system', () => {
    expect(trayIconFile(true, 0)).toBe('tray-light.png')
    expect(trayIconFile(false, 0)).toBe('tray-dark.png')
  })

  it('carries the count to nine and says more after that', () => {
    expect(trayIconFile(true, 1)).toBe('tray-light-1.png')
    expect(trayIconFile(true, 9)).toBe('tray-light-9.png')
    expect(trayIconFile(false, 10)).toBe('tray-dark-more.png')
    expect(trayIconFile(false, 400)).toBe('tray-dark-more.png')
  })
})

describe('what is said about what is waiting', () => {
  it('names direct messages and mentions apart, and in the singular for one', () => {
    expect(waitingSummary({ unread: 3, dms: 2, mentions: 1 })).toBe('2 direct messages, 1 mention')
    expect(waitingSummary({ unread: 1, dms: 1, mentions: 0 })).toBe('1 direct message')
    expect(waitingSummary({ unread: 4, dms: 0, mentions: 4 })).toBe('4 mentions')
  })

  it('leaves the tooltip plain with nothing waiting or the badge off', () => {
    expect(trayTooltip(NOTHING_WAITING, true)).toBe('moho')
    expect(trayTooltip({ unread: 2, dms: 1, mentions: 1 }, false)).toBe('moho')
    expect(trayTooltip({ unread: 2, dms: 1, mentions: 1 }, true)).toBe('moho - 1 direct message, 1 mention')
  })
})

describe('the menu', () => {
  const model = { state: NOTHING_WAITING, windowVisible: true, status: 'idle' as const, offered: [] }
  const labels = (items: ReturnType<typeof trayMenu>): string[] => items.map((i) => i.label ?? '-')

  it('offers no daemon plumbing, and a restart that is of moho as a whole', () => {
    const l = labels(trayMenu(model, acts()))
    expect(l).not.toContain('Restart daemon')
    expect(l).not.toContain('Stop daemon')
    expect(l).toContain('Restart moho')
  })

  it('says nothing is new, and offers nothing to open, when that is so', () => {
    const [first] = trayMenu(model, acts())
    expect(first.label).toBe('Nothing new')
    expect(first.enabled).toBe(false)
  })

  it('says what is waiting and opens it', () => {
    const a = acts()
    const [first] = trayMenu({ ...model, state: { unread: 2, dms: 1, mentions: 1 } }, a)
    expect(first.label).toBe('1 direct message, 1 mention - open')
    first.click?.({} as never, undefined, {} as never)
    expect(a.openLatest).toHaveBeenCalled()
  })

  it('has no notifications switch of its own: Do not disturb is that', () => {
    expect(labels(trayMenu(model, acts())).join('|')).not.toMatch(/notification/i)
    const status = trayMenu(model, acts()).find((i) => i.label === 'Status')
    expect((status?.submenu as { label: string }[]).map((s) => s.label)).toContain('Do not disturb')
  })

  it('offers only what the connected accounts can be set to', () => {
    const labelsOf = (offered: ('online' | 'idle' | 'dnd' | 'invisible')[]): string[] =>
      (trayMenu({ ...model, offered }, acts()).find((i) => i.label === 'Status')?.submenu as { label: string }[]).map((s) => s.label)
    expect(labelsOf(['online', 'dnd'])).toEqual(['Online', 'Do not disturb'])
    expect(labelsOf(['online', 'idle', 'dnd', 'invisible'])).toHaveLength(4)
    expect(labelsOf([])).toHaveLength(4)
  })

  it('asks for the window to be shown or hidden as it stands', () => {
    expect(labels(trayMenu({ ...model, windowVisible: true }, acts()))).toContain('Hide moho')
    expect(labels(trayMenu({ ...model, windowVisible: false }, acts()))).toContain('Show moho')
  })

  it('checks the status the accounts are at', () => {
    const status = trayMenu(model, acts()).find((i) => i.label === 'Status')
    const sub = status?.submenu as { label: string; checked: boolean }[]
    expect(sub.filter((s) => s.checked).map((s) => s.label)).toEqual(['Idle'])
    const none = trayMenu({ ...model, status: null }, acts()).find((i) => i.label === 'Status')?.submenu as { checked: boolean }[]
    expect(none.some((s) => s.checked)).toBe(false)
  })
})
