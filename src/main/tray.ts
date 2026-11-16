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
  /** The conversation the menu's first line opens, where the window has said. */
  latest?: string | null
  /** The conversations with something waiting, most recent first: what the menu lists by name. */
  waiting?: TrayWaiting[]
}

/** One conversation with something waiting. */
export interface TrayWaiting {
  id: string
  name: string
  count: number
  /** A direct message, as against somewhere this account was mentioned. */
  direct: boolean
}

export const NOTHING_WAITING: TrayState = { unread: 0, dms: 0, mentions: 0 }

export type TrayStatus = 'online' | 'idle' | 'dnd' | 'invisible'

/**
 * What the icon is saying besides the count.
 *
 * `offline`: no account is connected, or the daemon is not answering - nothing
 * will arrive, which is the one thing a glance at a quiet tray cannot tell
 * apart from "nothing has". `quiet`: Do not disturb, or notifications paused -
 * things are arriving and will not be announced.
 */
export type TrayMode = 'normal' | 'offline' | 'quiet'

/**
 * The icon file for a panel, a count and a mode.
 *
 * `dark` is the system's colour scheme, and a dark system wants the light
 * bubble. The count is drawn into the icon up to nine; past that it says "9+",
 * since a tray icon is about 22 pixels and has no room for a second digit.
 * Offline and quiet are icons of their own and carry no count: one has none
 * worth trusting, and the other was asked not to wave one about.
 */
export function trayIconFile(dark: boolean, unread: number, mode: TrayMode = 'normal'): string {
  const ink = dark ? 'light' : 'dark'
  if (mode !== 'normal') return `tray-${ink}-${mode}.png`
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

export function trayTooltip(s: TrayState, badge: boolean, mode: TrayMode = 'normal', quietWhy = 'do not disturb'): string {
  if (mode === 'offline') return 'moho - offline'
  const waiting = badge && s.unread > 0 ? waitingSummary(s) : ''
  if (mode === 'quiet') return waiting ? `moho - ${quietWhy}, ${waiting} waiting` : `moho - ${quietWhy}`
  return waiting ? `moho - ${waiting}` : 'moho'
}

/** How long notifications can be paused for from the tray. */
export type PauseChoice = '30m' | '1h' | 'morning' | 'forever'

/** Paused with no end: until somebody turns them back on. */
export const PAUSED_FOREVER = -1

const PAUSES: { id: PauseChoice; label: string }[] = [
  { id: '30m', label: 'For 30 minutes' },
  { id: '1h', label: 'For 1 hour' },
  { id: 'morning', label: 'Until tomorrow morning' },
  { id: 'forever', label: 'Until I turn them back on' }
]

/** When a pause chosen now ends, in milliseconds - or PAUSED_FOREVER. Tomorrow morning is eight o'clock. */
export function pauseEnd(choice: PauseChoice, now: number): number {
  if (choice === '30m') return now + 30 * 60_000
  if (choice === '1h') return now + 60 * 60_000
  if (choice === 'forever') return PAUSED_FOREVER
  const morning = new Date(now)
  morning.setDate(morning.getDate() + 1)
  morning.setHours(8, 0, 0, 0)
  return morning.getTime()
}

/** Whether notifications are paused at this moment, from what was stored when they were. */
export function isPaused(until: number, now: number): boolean {
  return until === PAUSED_FOREVER || until > now
}

export interface TrayActions {
  toggleWindow: () => void
  openLatest: () => void
  /** Opens one of the conversations listed as waiting. */
  openConversation: (id: string) => void
  /** Opens the page of everything waiting, for when there is more than the menu lists. */
  openMentions: () => void
  markAllRead: () => void
  pause: (choice: PauseChoice) => void
  resume: () => void
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
  /** What the connected accounts can be set to; none reported yet means all of them. */
  offered: TrayStatus[]
  /** What invisible is called: Matrix, which has only offline presence, says offline. */
  invisibleName: string
  /** When a pause ends, in words ("until 14:30", "until turned back on"), or null when nothing is paused. */
  paused?: string | null
  /** Said in the last line, where given. */
  version?: string
}

const STATUSES: { id: TrayStatus; label: string }[] = [
  { id: 'online', label: 'Online' },
  { id: 'idle', label: 'Idle' },
  { id: 'dnd', label: 'Do not disturb' },
  { id: 'invisible', label: 'Invisible' }
]

/** How many waiting conversations the menu names before it says "and N more". */
const LISTED = 5

/** A name short enough for a menu line. */
const brief = (name: string): string => (name.length > 36 ? `${name.slice(0, 35)}…` : name)

/**
 * The right-click menu: what is new and where, how to get to moho, how to say
 * what you are doing, how to have some quiet, and how to leave.
 *
 * Quiet is two things here on purpose. Do not disturb, under Status, is said
 * to everybody else as well. Pausing notifications is this machine's alone:
 * nobody sees it, and it ends by itself. Daemon plumbing - restart it, stop
 * it - is deliberately not here; it is a thing for Settings, and "restart
 * moho" covers what somebody reaching for it from a tray actually wants.
 */
export function trayMenu(model: TrayModel, act: TrayActions): MenuItemConstructorOptions[] {
  const waiting = model.state.unread > 0
  const listed = model.state.waiting ?? []
  const named: MenuItemConstructorOptions[] = listed.slice(0, LISTED).map((w) => ({
    label: `${brief(w.name)} - ${w.direct ? w.count : plural(w.count, 'mention', 'mentions')}`,
    click: () => act.openConversation(w.id)
  }))
  if (listed.length > LISTED) named.push({ label: `and ${listed.length - LISTED} more…`, click: act.openMentions })
  return [
    ...(waiting
      ? [
          // With the conversations named below it, the first line is the heading; without, it is the way in.
          named.length > 0
            ? { label: waitingSummary(model.state), enabled: false }
            : { label: `${waitingSummary(model.state)} - open`, click: act.openLatest },
          ...named,
          { label: 'Mark everything read', click: act.markAllRead }
        ]
      : [{ label: 'Nothing new', enabled: false }]),
    { type: 'separator' },
    { label: model.windowVisible ? 'Hide moho' : 'Show moho', click: act.toggleWindow },
    {
      label: 'Status',
      submenu: STATUSES.filter((s) => model.offered.length === 0 || model.offered.includes(s.id)).map((s) => ({
        label: s.id === 'invisible' ? model.invisibleName : s.label,
        type: 'radio' as const,
        checked: model.status === s.id,
        click: () => act.setStatus(s.id)
      }))
    },
    model.paused
      ? { label: `Resume notifications (paused ${model.paused})`, click: act.resume }
      : { label: 'Pause notifications', submenu: PAUSES.map((p) => ({ label: p.label, click: () => act.pause(p.id) })) },
    { label: 'Settings', click: act.openSettings },
    { type: 'separator' },
    { label: 'Restart moho', click: act.restart },
    { label: 'Quit', click: act.quit },
    ...(model.version ? [{ type: 'separator' as const }, { label: `moho ${model.version}`, enabled: false }] : [])
  ]
}
