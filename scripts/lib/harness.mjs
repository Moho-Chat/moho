/**
 * What the scripts that drive the real app share: a small fake IRC server to
 * give it something to show, the app launched against a throwaway home, and a
 * line to its window over the DevTools protocol.
 *
 * The app never touches a real account or the daemon of a moho already
 * running: HOME, the XDG directories and - because the daemon's socket lives
 * there - XDG_RUNTIME_DIR are all its own.
 */

import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

export const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- a fake IRC server ---------------------------------------------------

/**
 * A server that registers anybody and, when they join a channel, says
 * whatever `onJoin` says there.
 *
 * `caps` are offered and granted whole. `server-time` among them lets a line
 * carry when it was said (`at(date)` builds the tag), which is how history
 * from other days reaches the client.
 */
export function fakeIrc({ people = [], caps = [], onJoin } = {}) {
  const server = net.createServer((socket) => {
    let nick = 'checker'
    let negotiating = false
    let registered = false
    const send = (line) => socket.write(line + '\r\n')
    const welcome = () => {
      if (registered) return
      registered = true
      send(`:fake 001 ${nick} :Welcome`)
      send(`:fake 376 ${nick} :End of MOTD`)
    }
    let buffered = ''
    socket.on('error', () => {})
    socket.on('data', (chunk) => {
      buffered += chunk.toString()
      let at
      while ((at = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, at).replace(/\r$/, '')
        buffered = buffered.slice(at + 1)
        const [command, ...args] = line.split(' ')
        switch (command.toUpperCase()) {
          case 'CAP':
            if (args[0] === 'LS') {
              negotiating = true
              send(`:fake CAP * LS :${caps.join(' ')}`)
            } else if (args[0] === 'REQ') {
              send(`:fake CAP * ACK ${args.slice(1).join(' ')}`)
            } else if (args[0] === 'END') {
              negotiating = false
              welcome()
            }
            break
          case 'NICK':
            nick = args[0]
            break
          case 'USER':
            if (!negotiating) welcome()
            break
          case 'PING':
            send(`:fake PONG fake ${args.join(' ')}`)
            break
          case 'JOIN':
            for (const channel of args[0].split(',')) {
              send(`:${nick}!u@h JOIN ${channel}`)
              send(`:fake 353 ${nick} = ${channel} :${[nick, ...people].join(' ')}`)
              send(`:fake 366 ${nick} ${channel} :End of NAMES`)
              onJoin?.(channel, nick, send)
            }
            break
        }
      }
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

/** The server-time tag for a moment. */
export const at = (date) => `@time=${date.toISOString()} `

// --- the app, and a line to it --------------------------------------------

export async function freePort() {
  const probe = net.createServer()
  await new Promise((r) => probe.listen(0, '127.0.0.1', r))
  const { port } = probe.address()
  await new Promise((r) => probe.close(r))
  return port
}

async function pageTarget(port) {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools:'))
      if (page) return page
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }
  throw new Error('the app never opened a window')
}

export function cdp(url) {
  const socket = new WebSocket(url)
  let id = 0
  const waiting = new Map()
  const listeners = new Map()
  socket.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id)
      waiting.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) ?? []) fn(msg.params)
    }
  })
  const ready = new Promise((r) => socket.addEventListener('open', r))
  const call = async (method, params = {}) => {
    await ready
    const n = ++id
    socket.send(JSON.stringify({ id: n, method, params }))
    return new Promise((resolve, reject) => waiting.set(n, { resolve, reject }))
  }
  const evaluate = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, new Set())
    listeners.get(method).add(fn)
    return () => listeners.get(method).delete(fn)
  }
  return { call, evaluate, on, close: () => socket.close() }
}

/** Waits until an expression in the page is truthy. */
export async function until(page, expression, what, ms = 30000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await page.evaluate(`!!(${expression})`).catch(() => false)) return
    await sleep(250)
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** Clicks the first element matching `selector` whose text or title holds `text`. */
export const click = (selector, text) => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
    .find((e) => ${JSON.stringify(text ?? '')} === '' || (e.innerText + ' ' + (e.title || '')).includes(${JSON.stringify(text ?? '')}))
  if (!el) return false
  el.click()
  return true
})()`

/**
 * On Hyprland, out of the way: a window the harness opens should not land on
 * top of what the person running it is doing. Anywhere else, left alone.
 */
function moveAside(pid) {
  if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) return
  try {
    const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j'], { encoding: 'utf8' }))
    const descendants = new Set([pid])
    // The window belongs to Electron's browser process, a child of the one
    // spawned; walking /proc is enough to find it.
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue
      try {
        const stat = fs.readFileSync(`/proc/${entry}/stat`, 'utf8')
        const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
        if (descendants.has(ppid)) descendants.add(Number(entry))
      } catch {
        /* gone */
      }
    }
    for (const c of clients) {
      if (!descendants.has(c.pid)) continue
      execFileSync('hyprctl', [
        'dispatch',
        `hl.dsp.window.move({ window = "address:${c.address}", workspace = "${process.env.MOHO_HARNESS_WORKSPACE ?? '2'}", silent = true })`
      ])
    }
  } catch {
    /* not this compositor's dialect; leave it */
  }
}

/**
 * The built app, against a scratch home, with a debugging port. Returns the
 * page and a `stop()` that takes everything down again.
 */
export async function launchApp({ env = {} } = {}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'moho-ui-'))
  const run = path.join(scratch, 'run')
  fs.mkdirSync(run, { mode: 0o700 })
  const port = await freePort()

  // A CI runner's kernel refuses Chromium's sandbox (Ubuntu 24.04 restricts
  // the unprivileged namespaces it needs); there it runs without, as an
  // ordinary Chromium in a container does.
  const flags = [`--remote-debugging-port=${port}`, ...(process.env.CI ? ['--no-sandbox'] : [])]
  const app = spawn(electronPath, [root, ...flags], {
    cwd: root,
    detached: true,
    stdio: process.env.MOHO_UI_VERBOSE ? 'inherit' : 'ignore',
    env: {
      ...process.env,
      ...env,
      HOME: scratch,
      XDG_CONFIG_HOME: path.join(scratch, 'config'),
      XDG_CACHE_HOME: path.join(scratch, 'cache'),
      XDG_DATA_HOME: path.join(scratch, 'data'),
      XDG_STATE_HOME: path.join(scratch, 'state'),
      XDG_RUNTIME_DIR: run,
      // The runtime directory is moved so the daemon's socket is this run's
      // own - which also moves where a Wayland client looks for the
      // compositor. An absolute path keeps it pointing at the real one.
      ...(process.env.WAYLAND_DISPLAY && process.env.XDG_RUNTIME_DIR && !path.isAbsolute(process.env.WAYLAND_DISPLAY)
        ? { WAYLAND_DISPLAY: path.join(process.env.XDG_RUNTIME_DIR, process.env.WAYLAND_DISPLAY) }
        : {})
    }
  })

  const stop = async () => {
    page?.close()
    try {
      process.kill(-app.pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
    await sleep(1500)
    try {
      process.kill(-app.pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
    fs.rmSync(scratch, { recursive: true, force: true })
  }

  let page
  try {
    page = cdp((await pageTarget(port)).webSocketDebuggerUrl)
    moveAside(app.pid)
    await until(page, 'window.moho && document.querySelector("#root > *")', 'the window to load')
  } catch (e) {
    await stop()
    throw e
  }
  return { page, stop }
}

/**
 * An IRC account on the fake server, its channels joined, and the window
 * showing the first of them.
 */
export async function openIrcChannel(page, { port, nick, channels, waitFor }) {
  await until(page, 'window.moho.rpc("listAccounts", {}).then(() => true)', 'the daemon')
  await page.evaluate(
    `window.moho.rpc("addAccount", { nick: ${JSON.stringify(nick)}, host: "localhost", port: ${port}, ssl: false, autojoin: ${JSON.stringify(channels.join(','))} })`
  )
  await until(
    page,
    `window.moho.rpc("listBuffers", {}).then((b) => ${JSON.stringify(channels)}.every((c) => b.some((x) => x.id.endsWith("|" + c))))`,
    'the channels'
  )
  await page.call('Page.reload')
  await sleep(1000)
  await until(page, 'document.querySelector("[title*=\\"localhost\\"]")', 'the account in the rail')
  await page.evaluate(click('[title*="localhost"]'))
  await until(page, `[...document.querySelectorAll(".buffer-row")].some((r) => (r.title || r.innerText).includes(${JSON.stringify(channels[0])}))`, 'the channel row')
  await page.evaluate(click('.buffer-row', channels[0]))
  await until(page, `[...document.querySelectorAll(".message-row")].some((r) => r.innerText.includes(${JSON.stringify(waitFor)}))`, 'the messages')
}
