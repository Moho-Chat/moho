/**
 * What the tray says and offers, apart from the Electron objects that show it.
 *
 * Kept as plain functions of plain data so that what the icon, the tooltip and
 * the menu say about a given set of unread conversations can be checked
 * without a desktop to look at.
 */
import type { MenuItemConstructorOptions } from 'electron'

/** What is waiting, as the notifier counts it. */
export interface TrayState {
  /** Conversations with something unread that was worth a notification. */
  unread: number
  /** Of those, direct messages. */
  dms: number
  /** Of those, everything else: somebody mentioning this account in a channel. */
  mentions: number
}

export const NOTHING_WAITING: TrayState = { unread: 0, dms: 0, mentions: 0 }

export type TrayStatus = 'online' | 'idle' | 'dnd' | 'invisible'

/**
 * The icon file for a panel and a count.
 *
 * `dark` is the system's colour scheme, and a dark system wants the light
 * bubble. The count is drawn into the icon up to nine; past that it says "9+",
 * since a tray icon is about 22 pixels and has no room for a second digit.
 */
export function trayIconFile(dark: boolean, unread: number): string {
  const ink = dark ? 'light' : 'dark'
  if (unread <= 0) return `tray-${ink}.png`
  return `tray-${ink}-${unread > 9 ? 'more' : unread}.png`
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** "2 direct messages, 1 mention" - what is waiting, in the words a person would use. */
export function waitingSummary(s: TrayState): string {
  const parts: string[] = []
  if (s.dms > 0) parts.push(plural(s.dms, 'direct message', 'direct messages'))
  if (s.mentions > 0) parts.push(plural(s.mentions, 'mention', 'mentions'))
  return parts.join(', ')
}

export function trayTooltip(s: TrayState, badge: boolean): string {
  return badge && s.unread > 0 ? `moho - ${waitingSummary(s)}` : 'moho'
}

export interface TrayActions {
  toggleWindow: () => void
  openLatest: () => void
  openSettings: () => void
  setStatus: (status: TrayStatus) => void
  restart: () => void
  quit: () => void
}

export interface TrayModel {
  state: TrayState
  windowVisible: boolean
  /** The status the accounts are at, where the window has said. */
  status: TrayStatus | null
}

const STATUSES: { id: TrayStatus; label: string }[] = [
  { id: 'online', label: 'Online' },
  { id: 'idle', label: 'Idle' },
  { id: 'dnd', label: 'Do not disturb' },
  { id: 'invisible', label: 'Invisible' }
]

/**
 * The right-click menu: what is new, how to get to moho, how to say what you
 * are doing - which includes Do not disturb, the one switch for silencing it -
 * and how to leave. Daemon plumbing - restart it, stop it - is
 * deliberately not here; it is a thing for Settings, and "restart moho"
 * covers what somebody reaching for it from a tray actually wants.
 */
export function trayMenu(model: TrayModel, act: TrayActions): MenuItemConstructorOptions[] {
  const waiting = model.state.unread > 0
  return [
    waiting
      ? { label: `${waitingSummary(model.state)} - open`, click: act.openLatest }
      : { label: 'Nothing new', enabled: false },
    { type: 'separator' },
    { label: model.windowVisible ? 'Hide moho' : 'Show moho', click: act.toggleWindow },
    {
      label: 'Status',
      submenu: STATUSES.map((s) => ({
        label: s.label,
        type: 'radio' as const,
        checked: model.status === s.id,
        click: () => act.setStatus(s.id)
      }))
    },
    { label: 'Settings', click: act.openSettings },
    { type: 'separator' },
    { label: 'Restart moho', click: act.restart },
    { label: 'Quit', click: act.quit }
  ]
}
