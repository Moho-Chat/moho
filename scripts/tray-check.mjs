#!/usr/bin/env node
/**
 * Checks the tray against the running app: what its icon, tooltip and menu say
 * for what is waiting, what its entries do, and that "Restart moho" brings back
 * moho and a daemon of its own.
 *
 * A tray cannot be photographed, so this reads what main last gave it through a
 * hook that exists only under MOHO_UI_SHOTS, and presses its entries the same
 * way. Main is reached over the Node inspector the app is started with.
 *
 *   npm run test:tray        (builds first; needs the daemon built too)
 */
import fs from 'node:fs'
import { cdp, freePort, launchApp, sleep, until } from './lib/harness.mjs'

let failures = 0
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : detail ? ` - ${detail}` : ''}`)
  if (!ok) failures++
}

async function mainProcess(inspectPort) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${inspectPort}/json/list`)).json()
      const target = list.find((t) => t.webSocketDebuggerUrl)
      if (target) return cdp(target.webSocketDebuggerUrl)
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }
  throw new Error('main never offered its inspector')
}

/** The nobilis processes that belong to this run, by the runtime directory in their environment. */
function daemons(scratch) {
  const out = []
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    try {
      const exe = fs.readlinkSync(`/proc/${entry}/exe`)
      if (!exe.endsWith('/nobilis')) continue
      if (fs.readFileSync(`/proc/${entry}/environ`, 'utf8').includes(`XDG_RUNTIME_DIR=${scratch}/run`)) out.push(Number(entry))
    } catch {
      /* gone, or not ours */
    }
  }
  return out
}

// A run that hangs is a failure, and must not leave an app behind it.
setTimeout(() => {
  console.log('FAIL timed out')
  process.exit(1)
}, 150000).unref()

const inspectPort = await freePort()
const { page, stop, port } = await launchApp({ env: { MOHO_UI_SHOTS: '1' }, args: [`--inspect=${inspectPort}`] })
let scratchDir = ''
try {
  const main = await mainProcess(inspectPort)
  const tray = (expr) => main.evaluate(`(() => { const t = globalThis.__mohoTray; return ${expr} })()`)
  await until(main, 'globalThis.__mohoTray', 'the tray')
  scratchDir = await main.evaluate('process.env.HOME')

  // Nothing waiting.
  await tray('t.update({ unread: 0, dms: 0, mentions: 0 })'.replace('t.', 't.'))
  check(/^tray-(light|dark)\.png$/.test(await tray('t.icon()')), 'idle: the plain bubble', await tray('t.icon()'))
  check((await tray('t.menu()[0].label')) === 'Nothing new', 'idle: the menu says nothing is new')
  check((await tray('t.tooltip()')) === 'moho', 'idle: the tooltip is just moho')

  // Something waiting: the count is on the icon, and the menu says what.
  await tray('t.update({ unread: 3, dms: 2, mentions: 1 })')
  check(/^tray-(light|dark)-3\.png$/.test(await tray('t.icon()')), 'waiting: the icon carries the count', await tray('t.icon()'))
  check((await tray('t.tooltip()')) === 'moho - 2 direct messages, 1 mention', 'waiting: the tooltip says what', await tray('t.tooltip()'))
  check((await tray('t.menu()[0].label')) === '2 direct messages, 1 mention - open', 'waiting: the menu says what', await tray('t.menu()[0].label'))
  await tray('t.update({ unread: 40, dms: 40, mentions: 0 })')
  check(/-more\.png$/.test(await tray('t.icon()')), 'a great many: the icon says 9+')
  await tray('t.update({ unread: 0, dms: 0, mentions: 0 })')

  // The entries, and that none of them is daemon plumbing.
  const labels = await tray('t.menu().map((i) => i.label ?? "-")')
  check(!labels.some((l) => /daemon/i.test(l)), 'the menu offers no daemon plumbing', labels.join(' | '))
  check(labels.includes('Restart moho'), 'the menu offers Restart moho')

  // Settings opens in the window.
  await tray('t.click(["Settings"])')
  await until(page, 'window.__mohoShots.state().activePanel === "settings"', 'Settings to open')
  check(true, 'Settings opens the settings page')

  // A status goes to the window to carry out.
  await page.evaluate('window.__trayGot = []; window.moho.onTrayCommand((c, a) => window.__trayGot.push([c, a])); true')
  await tray('t.click(["Status", "Do not disturb"])')
  await until(page, 'window.__trayGot.length', 'the status to reach the window')
  check(JSON.stringify(await page.evaluate('window.__trayGot[0]')) === '["status","dnd"]', 'a status is handed to the window')

  // Desktop notifications is a real setting, shared with Settings.
  await tray('t.click(["Desktop notifications"])')
  await until(page, 'window.moho.prefs.getAll().then((p) => p["notifications.desktop"] === false)', 'the setting to change')
  check(true, 'Desktop notifications toggles the setting')
  check((await tray('t.menu().find((i) => i.label === "Desktop notifications").checked')) === false, 'and the menu shows it off')

  // Restart brings back moho and a daemon of its own.
  const before = daemons(scratchDir)
  const pidBefore = await main.evaluate('process.pid')
  check(before.length === 1, 'one daemon is running', String(before))
  // Not waited for: the app quits under this call, and the inspector with it.
  void tray('t.click(["Restart moho"])').catch(() => {})
  // And the inspector let go, because a process that is being inspected waits
  // for the inspector to disconnect before it will exit.
  await sleep(500)
  main.close()
  let pidAfter = pidBefore
  let again = null
  for (let i = 0; i < 80 && pidAfter === pidBefore; i++) {
    await sleep(500)
    try {
      again = await mainProcess(inspectPort)
      pidAfter = await again.evaluate('process.pid')
    } catch {
      /* between the two */
    }
  }
  check(pidAfter !== pidBefore, 'moho came back as a new process', `${pidBefore} -> ${pidAfter}`)
  await sleep(4000)
  const after = daemons(scratchDir)
  check(after.length === 1 && !before.includes(after[0]), 'with a daemon of its own, the old one gone', `${before} -> ${after}`)
  // Whatever it started has to go with this run.
  try {
    for (const pid of daemons(scratchDir)) process.kill(pid, 'SIGTERM')
  } catch {
    /* gone */
  }
} catch (e) {
  console.log('FAIL', e.message)
  failures++
} finally {
  await stop()
  // The relaunched copy is not the one the harness started, so it is not in the
  // group stop() ended. It is found by the home it was given, which everything
  // it starts - its daemon, and the helpers Chromium runs that name no port -
  // carries in its environment; twice, since it may still be starting.
  for (let i = 0; i < 2; i++) {
    await sleep(1500)
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry) || Number(entry) === process.pid || !scratchDir) continue
      try {
        if (fs.readFileSync(`/proc/${entry}/environ`, 'utf8').includes(`HOME=${scratchDir}\0`)) process.kill(Number(entry), 'SIGKILL')
      } catch {
        /* gone, or not ours to read */
      }
    }
  }
  await sleep(500)
  if (scratchDir) fs.rmSync(scratchDir, { recursive: true, force: true })
}
console.log(failures ? `${failures} failed` : 'all passed')
process.exit(failures ? 1 : 0)
