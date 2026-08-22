/**
 * Logging in the main process that cannot take the app down with it.
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
 */

let broken = false

function write(method: 'log' | 'warn' | 'error', args: unknown[]): void {
  if (broken) return
  try {
    console[method](...args)
  } catch {
    // Includes the EIO above. Nothing can be reported about a failure to
    // report, so stop trying.
    broken = true
  }
}

export const log = {
  info: (...args: unknown[]): void => write('log', args),
  warn: (...args: unknown[]): void => write('warn', args),
  error: (...args: unknown[]): void => write('error', args),
  /** Test seam: lets a check assert the latch without a broken stdout. */
  isBroken: (): boolean => broken
}
