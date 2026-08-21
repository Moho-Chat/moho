import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

/**
 * Spawns and supervises the nobilis daemon. nobilis holds an flock()-based
 * singleton lock on its data dir (nobilis/src/main.rs's acquire_singleton_lock),
 * so a restart must wait for the old process to actually exit before
 * respawning - flipping it straight back on races the replacement against the
 * lock the dying process still holds.
 *
 * A nonzero exit right at startup usually just means a nobilis from another
 * session is already listening; that is not an error worth surfacing, the RPC
 * client will connect to whichever process actually owns the socket.
 */
export class NobilisProcess {
  private child: ChildProcess | null = null
  private restartPending = false

  readonly binaryPath: string

  constructor() {
    this.binaryPath = app.isPackaged
      ? path.join(process.resourcesPath, 'nobilis')
      // In development the daemon is built inside its own submodule checkout.
      : path.join(app.getAppPath(), 'nobilis', 'target', 'release', 'nobilis')
  }

  available(): boolean {
    return fs.existsSync(this.binaryPath)
  }

  start(): void {
    if (this.child) return
    if (!this.available()) {
      console.warn(
        `[nobilis] binary not found at ${this.binaryPath} - not spawning. ` +
          'Run `cargo build --release`, or start nobilis yourself.'
      )
      return
    }

    const child = spawn(this.binaryPath, [], { stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child

    lineStream(child.stdout, (line) => console.log('[nobilis]', line))
    lineStream(child.stderr, (line) => console.log('[nobilis]', line))

    child.on('exit', (code) => {
      console.log('[nobilis] exited, code:', code)
      this.child = null
      if (this.restartPending) {
        this.restartPending = false
        this.start()
      }
    })

    child.on('error', (err) => {
      console.error('[nobilis] failed to spawn:', err.message)
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
   */
  stop(): void {
    this.restartPending = false
    this.child?.kill('SIGTERM')
    this.child = null
  }
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
