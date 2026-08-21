import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import type { ChatdEvent } from '../shared/wire'

/**
 * Newline-delimited JSON-RPC client for chatd's Unix socket (see
 * chatd/src/rpc/mod.rs). One socket serves both consumers - the renderer's
 * chat UI and main's own notification/tray bookkeeping - because `subscribe`
 * state is per-connection and the renderer subscribes to every buffer anyway,
 * so a second connection would only duplicate the same event stream.
 */

export function defaultSocketPath(): string {
  const runtimeDir = process.env.XDG_RUNTIME_DIR || os.tmpdir()
  return path.join(runtimeDir, 'moho', 'chatd.sock')
}

interface Pending {
  resolve: (value: any) => void
  reject: (reason: Error) => void
}

const RECONNECT_MIN_MS = 250
const RECONNECT_MAX_MS = 5000

export declare interface ChatdClient {
  on(event: 'push', listener: (frame: ChatdEvent) => void): this
  on(event: 'link', listener: (up: boolean) => void): this
}

export class ChatdClient extends EventEmitter {
  private socket: net.Socket | null = null
  private buffer = ''
  private nextId = 1
  private pending = new Map<number, Pending>()
  /** Requests issued while the link is down, replayed on connect. */
  private queue: string[] = []
  private reconnectDelay = RECONNECT_MIN_MS
  private reconnectTimer: NodeJS.Timeout | null = null
  private stopped = false

  linkUp = false

  constructor(private socketPath: string = defaultSocketPath()) {
    super()
  }

  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.socket?.destroy()
    this.socket = null
    this.setLink(false)
  }

  private connect(): void {
    if (this.stopped || this.socket) return

    const sock = net.createConnection({ path: this.socketPath })
    this.socket = sock

    sock.on('connect', () => {
      this.reconnectDelay = RECONNECT_MIN_MS
      this.setLink(true)
      const queued = this.queue
      this.queue = []
      for (const line of queued) sock.write(line)
    })

    sock.on('data', (chunk) => this.onData(chunk))

    // 'error' always precedes 'close' for a failed connect; do the teardown
    // once, in 'close', so a refused connection and a dropped one take the
    // same path.
    sock.on('error', () => {})
    sock.on('close', () => {
      this.socket = null
      this.buffer = ''
      this.setLink(false)
      // A request whose response can never arrive now must reject rather
      // than hang forever - the caller can retry against the new link.
      const inFlight = [...this.pending.values()]
      this.pending.clear()
      for (const p of inFlight) p.reject(new Error('chatd connection lost'))
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS)
  }

  private setLink(up: boolean): void {
    if (this.linkUp === up) return
    this.linkUp = up
    this.emit('link', up)
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8')
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(idx + 1)
      if (!line) continue
      let msg: any
      try {
        msg = JSON.parse(line)
      } catch {
        console.warn('[chatd] unparseable line:', line.slice(0, 200))
        continue
      }
      this.dispatch(msg)
    }
  }

  private dispatch(msg: any): void {
    if (msg.event) {
      this.emit('push', msg as ChatdEvent)
      return
    }
    const pending = this.pending.get(msg.id)
    if (!pending) return
    this.pending.delete(msg.id)
    if (msg.error) pending.reject(new Error(String(msg.error)))
    else pending.resolve(msg.result ?? null)
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++
    const line = JSON.stringify({ id, method, params }) + '\n'
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      if (this.linkUp && this.socket) this.socket.write(line)
      else this.queue.push(line)
    })
  }
}
