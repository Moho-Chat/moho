import { countedFor, isDirectMessage } from './groups'
import { bufferDisplayName } from './util'
import type { BufferEntry } from '../state/store'

/** As many as the menu could ever say it has: the five it names, and enough past them to say how many more. */
const LISTED = 20

/** What the tray is told is waiting. */
export interface TrayCount {
  /** Unread direct messages, counted by the message. */
  dms: number
  /** Mentions in everywhere that is not a direct message, counted by the mention. */
  mentions: number
  /** The conversation to open from the tray: the most recently active one with something counted. */
  latest: string | null
  /** Each conversation with something counted, most recently active first, for the tray's menu to name. */
  waiting: { id: string; name: string; count: number; direct: boolean }[]
}

/**
 * The number on the tray, worked out the way the rail's is.
 *
 * The tray used to keep a count of its own in the main process, from the
 * notifications it was sent and a handful of "this was read" messages, and the
 * two drifted: a read on another device cleared the window and not the tray, a
 * mention in the conversation already open raised the tray and was never
 * counted by the window, and a room muted afterwards stayed in the tray's
 * number. It also counted conversations where the rail counts messages.
 *
 * So the window - which already knows every one of those things, because it is
 * what draws them - says what is waiting, by the same rule as the rail: a
 * muted or hidden conversation does not count, a direct message counts for each
 * unread message in it, and anywhere else counts for its mentions.
 */
export function trayCount(buffers: BufferEntry[], muted: string[], hidden: string[], mutedGroups: string[]): TrayCount {
  let dms = 0
  let mentions = 0
  const counted: { buffer: BufferEntry; count: number }[] = []
  for (const b of buffers) {
    const waiting = countedFor(b, muted, hidden, mutedGroups)
    if (waiting <= 0) continue
    if (isDirectMessage(b)) dms += waiting
    else mentions += waiting
    counted.push({ buffer: b, count: waiting })
  }
  counted.sort((a, b) => b.buffer.lastActivityTs - a.buffer.lastActivityTs)
  return {
    dms,
    mentions,
    latest: counted[0]?.buffer.id ?? null,
    waiting: counted.slice(0, LISTED).map(({ buffer, count }) => ({ id: buffer.id, name: bufferDisplayName(buffer.name), count, direct: isDirectMessage(buffer) }))
  }
}
