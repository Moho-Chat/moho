#!/usr/bin/env node
/**
 * Layout checks against the real app: nothing that opens over the UI may
 * extend outside the window.
 *
 * Unit tests cannot see this. A DOM without a layout engine measures every
 * element as 0x0 at 0,0, so a popup hanging off the bottom of the screen
 * passes there - which is how one shipped (#211: the emoji picker opened 134
 * pixels below the screen, because it was placed once against its first,
 * short measurement and then grew). So this launches the built app with a
 * debugging port, gives it something to open popups over, and measures.
 *
 * Measured several times after each popup opens, not once: the bug above was
 * precisely that the first measurement was not the last one.
 *
 * Self-contained. The app runs against a throwaway home directory, so no real
 * account is touched, and the conversation it opens popups over is served by
 * a small fake IRC server started here: a channel, some people in it, and a
 * few things said.
 *
 *   npm run test:ui          (builds first; needs the daemon built too)
 *
 * On a machine with no display, run it under xvfb-run.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/** When each popup is measured after it is opened, in milliseconds. */
const SAMPLES = [80, 400, 1500, 3500]

/** Window sizes to check at: an ordinary window, and a cramped one. */
const SIZES = [
  { width: 1280, height: 800 },
  { width: 760, height: 560 }
]

/** Everything that opens on top of the UI. */
const POPUPS = '.context-menu, .emoji-picker, .header-popover, .profile-card, [role="dialog"], [role="menu"]'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- a fake IRC server ---------------------------------------------------

const PEOPLE = ['alice', 'bob', 'carol', 'dave_the_longer_named', 'eve']

function fakeIrc() {
  const server = net.createServer((socket) => {
    let nick = 'checker'
    const send = (line) => socket.write(line + '\r\n')
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
            if (args[0] === 'LS') send(':fake CAP * LS :')
            break
          case 'NICK':
            nick = args[0]
            break
          case 'USER':
            send(`:fake 001 ${nick} :Welcome`)
            send(`:fake 376 ${nick} :End of MOTD`)
            break
          case 'PING':
            send(`:fake PONG fake ${args.join(' ')}`)
            break
          case 'JOIN': {
            const channel = args[0].split(',')[0]
            send(`:${nick}!u@h JOIN ${channel}`)
            send(`:fake 353 ${nick} = ${channel} :${[nick, ...PEOPLE].join(' ')}`)
            send(`:fake 366 ${nick} ${channel} :End of NAMES`)
            for (let i = 0; i < 12; i++) {
              const who = PEOPLE[i % PEOPLE.length]
              send(`:${who}!u@h PRIVMSG ${channel} :line ${i + 1} from ${who}, long enough to wrap on a narrow window`)
            }
            break
          }
        }
      }
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

// --- the app, and a line to it --------------------------------------------

async function freePort() {
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

function cdp(url) {
  const socket = new WebSocket(url)
  let id = 0
  const waiting = new Map()
  socket.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id)
      waiting.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
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
  return { call, evaluate, close: () => socket.close() }
}

/** Waits until an expression in the page is truthy. */
async function until(page, expression, what, ms = 30000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await page.evaluate(`!!(${expression})`).catch(() => false)) return
    await sleep(250)
  }
  throw new Error(`timed out waiting for ${what}`)
}

// --- the checks -------------------------------------------------------------

/** Where every open popup is, against the window. */
const MEASURE = `(() => {
  const w = innerWidth, h = innerHeight
  return [...document.querySelectorAll(${JSON.stringify(POPUPS)})]
    .filter((el) => el.getClientRects().length > 0)
    .map((el) => {
      const r = el.getBoundingClientRect()
      return {
        what: el.className || el.getAttribute('role'),
        left: Math.round(r.left), top: Math.round(r.top),
        right: Math.round(r.right), bottom: Math.round(r.bottom),
        inside: r.left >= -1 && r.top >= -1 && r.right <= w + 1 && r.bottom <= h + 1,
        viewport: w + 'x' + h
      }
    })
})()`

/** A right-click at the window's far corner, on whatever element is named. */
const rightClickInCorner = (selector, text) => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
    .find((e) => ${JSON.stringify(text ?? '')} === '' || (e.innerText + " " + (e.title || "")).includes(${JSON.stringify(text ?? '')}))
  if (!el) return false
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: innerWidth - 2, clientY: innerHeight - 2, button: 2 }))
  return true
})()`

const click = (selector, text) => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
    .find((e) => ${JSON.stringify(text ?? '')} === '' || (e.innerText + ' ' + (e.title || '')).includes(${JSON.stringify(text ?? '')}))
  if (!el) return false
  el.click()
  return true
})()`

const SCENARIOS = [
  { name: 'emoji picker', open: click('button[title="Emoji"]') },
  { name: 'channel list menu, opened in the corner', open: rightClickInCorner('.buffer-row', '#ui') },
  { name: 'message menu, opened in the corner', open: rightClickInCorner('.message-row', 'line 12') },
  { name: 'member menu, opened in the corner', open: rightClickInCorner('.nick-row', 'alice') },
  { name: 'mentions inbox', open: click('button[title="Mentions"]') }
]

async function closePopups(page) {
  for (const type of ['keyDown', 'keyUp']) {
    await page.call('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  }
  await sleep(150)
  // Whatever Escape did not close, a click on empty space does.
  if ((await page.evaluate(MEASURE)).length > 0) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await page.call('Input.dispatchMouseEvent', { type, x: 5, y: 5, button: 'left', clickCount: 1 })
    }
    await sleep(150)
  }
}

async function main() {
  const irc = await fakeIrc()
  const ircPort = irc.address().port
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

  const failures = []
  let checked = 0
  let page
  try {
    page = cdp((await pageTarget(port)).webSocketDebuggerUrl)
    await until(page, 'window.moho && document.querySelector("#root > *")', 'the window to load')

    // An account on the fake server, with a channel to open popups over.
    await until(page, 'window.moho.rpc("listAccounts", {}).then(() => true)', 'the daemon')
    await page.evaluate(
      `window.moho.rpc("addAccount", { nick: "checker", host: "localhost", port: ${ircPort}, ssl: false, autojoin: "#ui" })`
    )
    await until(page, 'window.moho.rpc("listBuffers", {}).then((b) => b.some((x) => x.id.endsWith("|#ui")))', 'the channel')
    await page.call('Page.reload')
    await sleep(1000)
    await until(page, 'document.querySelector("[title*=\\"localhost\\"]")', 'the account in the rail')
    await page.evaluate(click('[title*="localhost"]'))
    await until(page, `[...document.querySelectorAll(".buffer-row")].some((r) => (r.title || r.innerText).includes("#ui"))`, 'the channel row')
    await page.evaluate(click('.buffer-row', '#ui'))
    await until(page, `[...document.querySelectorAll(".message-row")].some((r) => r.innerText.includes("line 12"))`, 'the messages')

    for (const size of SIZES) {
      await page.call('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: false })
      await sleep(400)
      for (const scenario of SCENARIOS) {
        await closePopups(page)
        const opened = await page.evaluate(scenario.open)
        const label = `${scenario.name} at ${size.width}x${size.height}`
        if (!opened) {
          failures.push(`${label}: nothing to open it from`)
          continue
        }
        let seen = false
        let started = 0
        for (const at of SAMPLES) {
          await sleep(at - started)
          started = at
          const rects = await page.evaluate(MEASURE)
          if (rects.length > 0) seen = true
          for (const r of rects) {
            checked++
            if (!r.inside) {
              failures.push(
                `${label}, ${at}ms: "${r.what}" at ${r.left},${r.top} to ${r.right},${r.bottom} is outside the ${r.viewport} window`
              )
            }
          }
        }
        if (!seen) failures.push(`${label}: it did not open`)
        else console.log(`  ok  ${label}`)
      }
    }
  } finally {
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
    irc.close()
    fs.rmSync(scratch, { recursive: true, force: true })
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} layout failure(s):`)
    for (const f of failures) console.error(`  FAIL ${f}`)
    process.exit(1)
  }
  console.log(`\n${checked} measurements, every popup inside the window.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
