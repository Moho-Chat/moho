import { describe, expect, it, vi } from 'vitest'
import { isPaused, pauseEnd, trayIconFile, trayMenu, trayTooltip, waitingSummary, NOTHING_WAITING, PAUSED_FOREVER, type TrayActions } from './tray'

const acts = (): TrayActions => ({
  toggleWindow: vi.fn(),
  openLatest: vi.fn(),
  openConversation: vi.fn(),
  openMentions: vi.fn(),
  markAllRead: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
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
  const model = { state: NOTHING_WAITING, windowVisible: true, status: 'idle' as const, offered: [], invisibleName: 'Invisible' }
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

  it('names what is waiting, each opening its own conversation, and offers to mark it all read', () => {
    const a = acts()
    const waiting = [
      { id: 'd|gk', name: 'Gaunt King', count: 2, direct: true },
      { id: 'd|#shots', name: '#screenshots', count: 1, direct: false }
    ]
    const menu = trayMenu({ ...model, state: { unread: 3, dms: 2, mentions: 1, waiting } }, a)
    expect(labels(menu).slice(0, 4)).toEqual(['2 direct messages, 1 mention', 'Gaunt King - 2', '#screenshots - 1 mention', 'Mark everything read'])
    expect(menu[0].enabled).toBe(false)
    menu[2].click?.({} as never, undefined, {} as never)
    expect(a.openConversation).toHaveBeenCalledWith('d|#shots')
    menu[3].click?.({} as never, undefined, {} as never)
    expect(a.markAllRead).toHaveBeenCalled()
  })

  it('names five and says how many more', () => {
    const a = acts()
    const waiting = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, name: `#room${i}`, count: 1, direct: false }))
    const menu = trayMenu({ ...model, state: { unread: 8, dms: 0, mentions: 8, waiting } }, a)
    expect(labels(menu)[6]).toBe('and 3 more…')
    menu[6].click?.({} as never, undefined, {} as never)
    expect(a.openMentions).toHaveBeenCalled()
  })

  it('keeps Do not disturb under Status, and pauses notifications apart from it', () => {
    const a = acts()
    const status = trayMenu(model, a).find((i) => i.label === 'Status')
    expect((status?.submenu as { label: string }[]).map((s) => s.label)).toContain('Do not disturb')
    const pause = trayMenu(model, a).find((i) => i.label === 'Pause notifications')
    const choices = pause?.submenu as { label: string; click: () => void }[]
    expect(choices.map((c) => c.label)).toEqual(['For 30 minutes', 'For 1 hour', 'Until tomorrow morning', 'Until I turn them back on'])
    choices[1].click()
    expect(a.pause).toHaveBeenCalledWith('1h')
    const paused = trayMenu({ ...model, paused: 'until 14:30' }, a)
    expect(labels(paused)).toContain('Resume notifications (paused until 14:30)')
    expect(labels(paused)).not.toContain('Pause notifications')
  })

  it('says its version last, where told it', () => {
    expect(labels(trayMenu({ ...model, version: '1.5.1' }, acts())).at(-1)).toBe('moho 1.5.1')
  })

  it('offers only what the connected accounts can be set to', () => {
    const labelsOf = (offered: ('online' | 'idle' | 'dnd' | 'invisible')[]): string[] =>
      (trayMenu({ ...model, offered }, acts()).find((i) => i.label === 'Status')?.submenu as { label: string }[]).map((s) => s.label)
    expect(labelsOf(['online', 'dnd'])).toEqual(['Online', 'Do not disturb'])
    expect(labelsOf(['online', 'idle', 'dnd', 'invisible'])).toHaveLength(4)
    expect(labelsOf([])).toHaveLength(4)
  })

  it('calls invisible offline where only Matrix has it', () => {
    const sub = trayMenu({ ...model, offered: ['online', 'invisible'], invisibleName: 'Offline' }, acts()).find((i) => i.label === 'Status')?.submenu as { label: string }[]
    expect(sub.map((s) => s.label)).toEqual(['Online', 'Offline'])
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

describe('the icon and tooltip when it is not business as usual', () => {
  it('has an icon of its own for offline and for quiet, without a count', () => {
    expect(trayIconFile(true, 4, 'offline')).toBe('tray-light-offline.png')
    expect(trayIconFile(false, 4, 'quiet')).toBe('tray-dark-quiet.png')
    expect(trayIconFile(false, 4, 'normal')).toBe('tray-dark-4.png')
  })

  it('says which in the tooltip', () => {
    const waiting = { unread: 3, dms: 3, mentions: 0 }
    expect(trayTooltip(waiting, true, 'offline')).toBe('moho - offline')
    expect(trayTooltip(waiting, true, 'quiet')).toBe('moho - do not disturb, 3 direct messages waiting')
    expect(trayTooltip(NOTHING_WAITING, true, 'quiet', 'notifications paused')).toBe('moho - notifications paused')
  })
})

describe('pausing notifications', () => {
  const noon = new Date(2026, 10, 16, 12, 0, 0).getTime()
  it('ends when it was said to', () => {
    expect(pauseEnd('30m', noon)).toBe(noon + 30 * 60_000)
    expect(pauseEnd('1h', noon)).toBe(noon + 3_600_000)
    expect(new Date(pauseEnd('morning', noon)).getHours()).toBe(8)
    expect(new Date(pauseEnd('morning', noon)).getDate()).toBe(17)
    expect(pauseEnd('forever', noon)).toBe(PAUSED_FOREVER)
  })
  it('is over once its end has passed, and never when there is none', () => {
    expect(isPaused(noon + 1, noon)).toBe(true)
    expect(isPaused(noon - 1, noon)).toBe(false)
    expect(isPaused(0, noon)).toBe(false)
    expect(isPaused(PAUSED_FOREVER, noon)).toBe(true)
  })
})
