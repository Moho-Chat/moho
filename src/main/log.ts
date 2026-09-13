import fs from 'fs'
import path from 'path'

/**
 * Logging in the main process that cannot take the app down with it, and that
 * still exists after the app has closed.
 *
 * `console.log` writes to stdout, and when nothing is attached to stdout that
 * write throws EIO *synchronously* - not as an 'error' event a listener could
 * absorb. Electron turns an uncaught exception in main into a modal error
 * dialog, so one stray log line is enough to make the app unusable.
 *
 * That is the normal case rather than an exotic one: started from a desktop
 * entry, a launcher or a tray autostart, moho has no terminal on the other end
 * of stdout, while nobilis-process pipes the daemon's entire output through
 * here - so the app would die as soon as the daemon said anything.
 *
 * Once a write has failed there is nowhere for logs to go, so the rest are
 * dropped rather than re-attempted per line.
 *
 * The consequence of surviving that way was that everything the daemon
 * reported went nowhere: stdout is /dev/null in a launched build, and
 * essentially all of this program's behaviour lives in the daemon. A backend
 * reconnecting, an auth failure, a prune that did not run - none of it left a
 * trace anybody could read afterwards or send to anybody else. So the same
 * lines also go to a file, which is the copy that outlives the process.
 */

let broken = false

function write(method: 'log' | 'warn' | 'error', args: unknown[]): void {
  toFile(method, args)
  if (broken) return
  try {
    console[method](...args)
  } catch {
    // Includes the EIO above. Nothing can be reported about a failure to
    // report, so stop trying.
    broken = true
  }
}

/**
 * How much log to keep, and how many generations of it.
 *
 * Two files of 4MB: enough that a session's worth of daemon chatter survives a
 * restart and can be sent to somebody, small enough that it can be read and
 * that nothing here quietly fills a disk. A log that needs managing is a log
 * people delete.
 */
const MAX_BYTES = 4 * 1024 * 1024
const FILE = 'moho.log'
const PREVIOUS = 'moho.log.1'

let handle: number | null = null
let written = 0
let directory: string | null = null
/** A separate latch from `broken`: a failing file says nothing about stdout. */
let fileBroken = false

/**
 * Where the log file goes. Called once at startup, from the one place that
 * knows - `app.getPath('userData')`.
 *
 * Passed in rather than read here so this module never imports electron: it is
 * the lowest thing in the main process and everything else imports it, and a
 * log that cannot be exercised without standing up an app is a log whose
 * rotation nobody checks.
 *
 * Deliberately not the daemon's data directory, which is where the ticket
 * suggested it. The client does not know that path - it spawns nobilis without
 * `--data-dir` and lets the daemon resolve its own, XDG rules and legacy
 * fallbacks included - so writing there would mean reimplementing somebody
 * else's path logic and being wrong the day it changes.
 */
function toDirectory(dir: string): void {
  directory = dir
  openFile()
}

function openFile(): void {
  if (fileBroken || !directory) return
  try {
    const file = path.join(directory, FILE)
    // Pick up where the last run left off, so a restart does not lose the
    // lines that explain why it restarted.
    written = fs.existsSync(file) ? fs.statSync(file).size : 0
    if (written >= MAX_BYTES) {
      rotate()
      return
    }
    handle = fs.openSync(file, 'a')
  } catch {
    fileBroken = true
  }
}

function rotate(): void {
  if (!directory) return
  try {
    if (handle !== null) {
      fs.closeSync(handle)
      handle = null
    }
    // One generation, replaced. Two files of a known size beats an unbounded
    // pile of dated ones that nobody prunes.
    fs.renameSync(path.join(directory, FILE), path.join(directory, PREVIOUS))
  } catch {
    // A rotation that fails must not stop logging - worst case the file grows
    // past the cap until the next attempt.
  }
  try {
    written = 0
    handle = fs.openSync(path.join(directory, FILE), 'a')
  } catch {
    fileBroken = true
  }
}

function toFile(method: 'log' | 'warn' | 'error', args: unknown[]): void {
  if (fileBroken || handle === null) return
  try {
    const line = `${new Date().toISOString()} ${method === 'log' ? 'info' : method} ${args
      .map((a) => (typeof a === 'string' ? a : inspect(a)))
      .join(' ')}\n`
    // Synchronous on purpose: the thing most worth having in this file is the
    // last line before a crash, and a queued async write is the line that does
    // not make it.
    fs.writeSync(handle, line)
    written += Buffer.byteLength(line)
    if (written >= MAX_BYTES) rotate()
  } catch {
    fileBroken = true
  }
}

/** Whatever an argument is, without throwing on a circular one. */
function inspect(value: unknown): string {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

export const log = {
  info: (...args: unknown[]): void => write('log', args),
  warn: (...args: unknown[]): void => write('warn', args),
  error: (...args: unknown[]): void => write('error', args),
  /** Test seam: lets a check assert the latch without a broken stdout. */
  isBroken: (): boolean => broken,
  toDirectory,
  /** Where the log is being written, for anything that wants to say so. */
  file: (): string | null => (directory && !fileBroken ? path.join(directory, FILE) : null)
}
