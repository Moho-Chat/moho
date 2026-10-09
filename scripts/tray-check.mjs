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
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { cdp, fakeIrc, freePort, launchApp, openIrcChannel, sleep, until } from './lib/harness.mjs'

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

  // There is no notifications switch of its own: Do not disturb is that.
  check(!labels.some((l) => /notification/i.test(l)), 'the menu has no notifications switch of its own', labels.join(' | '))

  // With an IRC account connected - which has away and back, and no invisible -
  // the menu offers what IRC can be set to, and the daemon takes it.
  const irc = await fakeIrc({ people: ['bob'], onJoin: (channel, _nick, send) => send(`:bob!b@h PRIVMSG ${channel} :hello there`) })
  try {
    await openIrcChannel(page, { port: irc.address().port, nick: 'checker', channels: ['#lobby'], waitFor: 'hello there' })
    await until(main, 'globalThis.__mohoTray.menu().find((i) => i.label === "Status").submenu.length === 3', 'the menu to offer only IRC\'s statuses')
    const offered = await tray('t.menu().find((i) => i.label === "Status").submenu.map((i) => i.label)')
    check(JSON.stringify(offered) === '["Online","Idle","Do not disturb"]', 'IRC alone: no Invisible is offered', JSON.stringify(offered))
    const statusOf = () => page.evaluate('window.moho.rpc("listAccounts", {}).then((a) => a.find((x) => x.id.startsWith("checker")).status)')
    await tray('t.click(["Status", "Idle"])')
    await until(page, 'window.moho.rpc("listAccounts", {}).then((a) => a.find((x) => x.id.startsWith("checker")).status === "idle")', 'IRC to go idle')
    check(true, 'Idle from the tray sets the IRC account idle')
    await tray('t.click(["Status", "Do not disturb"])')
    await until(page, 'window.moho.rpc("listAccounts", {}).then((a) => a.find((x) => x.id.startsWith("checker")).status === "dnd")', 'IRC to go to Do not disturb')
    check((await statusOf()) === 'dnd', 'Do not disturb from the tray sets it')
  } finally {
    irc.close()
  }

  // The tray being redrawn - which it is whenever something unread changes - must
  // not move the window: somebody who has chosen another server stays on it. The
  // redraw tells the window the link is up, and taking each for a reconnection
  // sent the pane back to the server of whatever conversation was open.
  const away = await page.evaluate('window.__mohoShots.state().activeGroupId')
  await page.evaluate('window.__mohoShots.store.selectGroup("~mentions")')
  for (let i = 0; i < 6; i++) {
    await tray(`t.update({ unread: ${i}, dms: ${i}, mentions: 0 })`)
    await sleep(200)
  }
  await sleep(1500)
  const stayed = await page.evaluate('window.__mohoShots.state().activeGroupId')
  check(stayed === '~mentions', 'a redrawn tray leaves the chosen server chosen', `${away} -> ${stayed}`)
  await tray('t.update({ unread: 0, dms: 0, mentions: 0 })')

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
  // The relaunched copy is not the one the harness started, so it is not in the
  // group stop() ends. It is found by the debugging port it was told to use -
  // it shows no environment to be found by - and what it started goes when it
  // does. Ended first, and twice since it may still be starting, because it
  // writes into the directory stop() is about to remove.
  for (let i = 0; i < 2; i++) {
    await sleep(1500)
    try {
      execFileSync('pkill', ['-9', '-f', `remote-debugging-port=${port}`])
    } catch {
      /* none left */
    }
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry) || Number(entry) === process.pid || !scratchDir) continue
      try {
        if (fs.readFileSync(`/proc/${entry}/environ`, 'utf8').includes(`HOME=${scratchDir}\0`)) process.kill(Number(entry), 'SIGKILL')
      } catch {
        /* gone, or not ours to read */
      }
    }
  }
  await sleep(1500)
  await stop().catch(() => {})
  if (scratchDir) fs.rmSync(scratchDir, { recursive: true, force: true })
}
console.log(failures ? `${failures} failed` : 'all passed')
process.exit(failures ? 1 : 0)
