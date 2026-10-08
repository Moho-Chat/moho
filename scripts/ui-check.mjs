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

import { click, fakeIrc, launchApp, openIrcChannel, sleep } from './lib/harness.mjs'

/** When each popup is measured after it is opened, in milliseconds. */
const SAMPLES = [80, 400, 1500, 3500]

/** Window sizes to check at: an ordinary window, and a cramped one. */
const SIZES = [
  { width: 1280, height: 800 },
  { width: 760, height: 560 }
]

/** Everything that opens on top of the UI. */
const POPUPS = '.context-menu, .emoji-picker, .header-popover, .profile-card, [role="dialog"], [role="menu"]'

const PEOPLE = ['alice', 'bob', 'carol', 'dave_the_longer_named', 'eve']

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
  const irc = await fakeIrc({
    people: PEOPLE,
    onJoin: (channel, _nick, send) => {
      for (let i = 0; i < 12; i++) {
        const who = PEOPLE[i % PEOPLE.length]
        send(`:${who}!u@h PRIVMSG ${channel} :line ${i + 1} from ${who}, long enough to wrap on a narrow window`)
      }
    }
  })

  const failures = []
  let checked = 0
  const { page, stop } = await launchApp()
  try {
    await openIrcChannel(page, { port: irc.address().port, nick: 'checker', channels: ['#ui'], waitFor: 'line 12' })

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
    await stop()
    irc.close()
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
