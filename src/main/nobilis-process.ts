import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { app } from 'electron'
import { log } from './log'

/** What the built daemon is called here. */
const DAEMON_BINARY = process.platform === 'win32' ? 'nobilis.exe' : 'nobilis'

/**
 * Owns the nobilis daemon's lifecycle - but adopts one that is already
 * running rather than assuming it must start its own.
 *
 * nobilis holds an flock()-based singleton lock on its data dir, so a second
 * copy would simply exit; blindly spawning would mean a pointless process
 * launch on every start, and the log noise of it dying. Checking the socket
 * first also means a daemon started by hand, by a systemd unit, or by another
 * frontend is used as-is.
 *
 * Stopping is asymmetric for the same reason: a daemon we spawned can be
 * signalled directly, but an adopted one has no child handle here, so it is
 * asked to stop over the socket instead (nobilis's `shutdown` method).
 */
export class NobilisProcess {
  private child: ChildProcess | null = null
  private restartPending = false
  /** True when this process attached to a daemon it did not start. */
  private adopted = false

  readonly binaryPath: string

  constructor() {
    this.binaryPath = app.isPackaged
      ? path.join(process.resourcesPath, DAEMON_BINARY)
      : NobilisProcess.builtDaemon()
  }

  /**
   * The daemon built inside the submodule checkout.
   *
   * Found by looking rather than by assuming, for the same reason the icons
   * are: unpackaged, Electron reports the running script's directory as the
   * app path, so `electron out/main/index.js` looked for the daemon under
   * out/main and never found it - which left a development run unable to
   * start a daemon at all, and saying so only in a log nobody reads.
   */
  private static builtDaemon(): string {
    let dir = app.getAppPath()
    for (let up = 0; up < 4; up++) {
      const candidate = path.join(dir, 'nobilis', 'target', 'release', DAEMON_BINARY)
      if (fs.existsSync(candidate)) return candidate
      dir = path.dirname(dir)
    }
    return path.join(app.getAppPath(), 'nobilis', 'target', 'release', DAEMON_BINARY)
  }

  available(): boolean {
    return fs.existsSync(this.binaryPath)
  }

  /** Whether the daemon this is talking to was already running at startup. */
  wasAdopted(): boolean {
    return this.adopted
  }

  /**
   * Connect-or-spawn. A successful connection means a daemon already owns the
   * socket, so this adopts it; a refused connection means nothing is there.
   *
   * A stale socket file left by a crash also refuses, which is the desired
   * answer - nobilis unlinks it on bind.
   */
  async ensureRunning(socketPath: string): Promise<void> {
    if (await isListening(socketPath)) {
      this.adopted = true
      log.info('[nobilis] adopting the daemon already listening on', socketPath)
      return
    }
    this.adopted = false
    this.start()
  }

  start(): void {
    if (this.child) return
    if (!this.available()) {
      log.warn(
        `[nobilis] binary not found at ${this.binaryPath} - not spawning. ` +
          'Run `cargo build --release`, or start nobilis yourself.'
      )
      return
    }

    const child = spawn(this.binaryPath, [], { stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child

    lineStream(child.stdout, (line) => log.info('[nobilis]', line))
    lineStream(child.stderr, (line) => log.info('[nobilis]', line))

    child.on('exit', (code) => {
      log.info('[nobilis] exited, code:', code)
      this.child = null
      if (this.restartPending) {
        this.restartPending = false
        this.start()
      }
    })

    child.on('error', (err) => {
      log.error('[nobilis] failed to spawn:', err.message)
      this.child = null
    })
  }

  restart(): void {
    if (!this.child) {
      this.start()
      return
    }
    this.restartPending = true
    this.child.kill('SIGTERM')
  }

  /**
   * SIGTERM rather than SIGKILL: nobilis's shutdown path sends real QUITs to
   * every connected IRC network before exiting (see nobilis/src/main.rs), which
   * a bare kill would skip - leaving a ghost session holding the nick until
   * the network's own ping timeout notices.
   *
   * That reasoning only holds where signals do. On Windows this is
   * TerminateProcess under another name and the QUITs are lost either way,
   * which is why quitting goes through `stopAndWait` and its shutdown RPC;
   * this remains the synchronous path used by `restart`, where a dropped
   * connection is about to be replaced by a fresh one anyway.
   */
  stop(): void {
    this.restartPending = false
    this.child?.kill('SIGTERM')
    this.child = null
  }

  /**
   * Stop the daemon and wait for it to actually be gone, whether or not this
   * process started it. Resolves once the socket stops answering, so a caller
   * can quit knowing the QUITs went out rather than cutting them short.
   *
   * `askToStop` sends the `shutdown` RPC - the only route to an adopted
   * daemon, which has no child handle here.
   */
  async stopAndWait(socketPath: string, askToStop: () => Promise<unknown>): Promise<void> {
    // Ask over the socket first whatever kind of daemon this is, rather than
    // signalling our own child and asking only an adopted one.
    //
    // A signal is not a portable way to say "shut down cleanly": Windows has
    // no SIGTERM, and Node maps kill('SIGTERM') there onto TerminateProcess,
    // which stops the daemon dead - skipping the QUITs whose absence leaves a
    // ghost session holding the nick until the network times it out. The
    // shutdown RPC means exactly the same thing on every system, and is a
    // request the daemon can act on rather than an end it cannot refuse.
    this.restartPending = false
    await askToStop().catch(() => {
      // No answer - it may already be gone, or wedged. Either way the signal
      // below and the escalation after it are what is left to try.
      this.child?.kill('SIGTERM')
    })

    // nobilis sends QUITs and sleeps briefly before exiting, so the socket
    // outlives the request by design. Poll rather than guess at a delay.
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      if (!(await isListening(socketPath))) return
      await new Promise((r) => setTimeout(r, 150))
    }
    // It did not go quietly - only now escalate, and only for our own child.
    this.child?.kill('SIGKILL')
    log.warn('[nobilis] daemon did not exit within 5s of being asked to stop')
  }
}

/** Whether anything is accepting connections on the socket right now. */
function isListening(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ path: socketPath })
    const done = (answer: boolean): void => {
      sock.destroy()
      resolve(answer)
    }
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
    sock.setTimeout(1500, () => done(false))
  })
}

function lineStream(stream: NodeJS.ReadableStream | null, onLine: (line: string) => void): void {
  if (!stream) return
  let buffered = ''
  stream.on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8')
    let idx: number
    while ((idx = buffered.indexOf('\n')) !== -1) {
      const line = buffered.slice(0, idx)
      buffered = buffered.slice(idx + 1)
      if (line) onLine(line)
    }
  })
}
