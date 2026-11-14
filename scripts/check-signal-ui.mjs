#!/usr/bin/env node
/**
 * The Signal parts of the window.
 *
 * In a scratch moho, always: the account picker offers Signal, and its form says what a linked device is, offers the QR
 * code and offers to bring back an exported device - nothing is started or sent.
 *
 * With --live, a window is also attached to a test daemon that has a linked account (the second moho,
 * ~/.local/share/moho-dev/moho2.sh start) and looks at what the probe left there (scripts/probe-signal.mjs, run first):
 * in Note to Self a reply with its quote, a picture on its message, the delivery ticks, a disappearing-timer line and a
 * view-once line; Stories with its "Post a story" entry; and a group's settings with who may send and its members.
 * Signal accounts cannot be made for a test, so there is nothing to sign in to in a scratch home. Quitting that window
 * stops the test daemon (restart it after); the live daemon is never the one attached.
 *
 *   node scripts/check-signal-ui.mjs <output directory> [--live /tmp/claude-1000/m2run]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp, sleep } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const liveAt = process.argv.indexOf('--live')
const liveRuntime = liveAt > 0 ? process.argv[liveAt + 1] : null
if (liveRuntime && path.resolve(liveRuntime) === path.resolve(process.env.XDG_RUNTIME_DIR ?? `/run/user/${os.userInfo().uid}`)) {
  console.error('That is the live daemon: --live takes a test daemon\'s runtime folder')
  process.exit(2)
}

const results = []
const check = (what, ok, detail = '') => {
  results.push(ok)
  console.log(ok ? '  ok  ' : '  FAIL', what, detail)
}

async function withWindow(options, body) {
  const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' }, ...options })
  const ev = (code) => page.evaluate(code)
  const shot = async (name) => {
    const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
  }
  try {
    await sleep(2500)
    await page.call('Emulation.setDeviceMetricsOverride', { width: 1200, height: 860, deviceScaleFactor: 1, mobile: false })
    await body(ev, shot)
  } finally {
    await stop()
  }
}

// The scratch half: the form, and nothing sent.
await withWindow({}, async (ev, shot) => {
  await ev(`window.__mohoShots.store.setActivePanel('accounts')`)
  await sleep(1200)
  const chip = await ev(`!![...document.querySelectorAll('.service-chip')].find((x) => x.textContent.includes('Signal'))`)
  check('the picker offers Signal', chip)
  await ev(`[...document.querySelectorAll('.service-chip')].find((x) => x.textContent.includes('Signal')).click()`)
  await sleep(500)
  const form = await ev(`document.querySelector('.add-form')?.innerText ?? ''`)
  check('the form says moho links as a second device and makes no account', /second device/.test(form) && /never makes an account/.test(form), form.slice(0, 120))
  check('it says what a third-party client risks', /third-party/.test(form) && /unlink/.test(form))
  check('it offers the QR code', /Link with a QR code/.test(form))
  check('it offers to bring back an exported device', /Bring back an account exported from moho/.test(form))
  await shot('signal-form.png')
})

if (liveRuntime) {
  // The window's own runtime folder holds the test daemon's socket folder, so it attaches instead of starting one.
  const seed = (scratch) => fs.symlinkSync(path.join(path.resolve(liveRuntime), 'nobilis'), path.join(scratch, 'run', 'nobilis'))
  await withWindow({ seed }, async (ev, shot) => {
    await sleep(3000)
    const buffers = await ev(`window.moho.rpc('listBuffers', {})`)
    const signal = buffers.filter((b) => (b.accountId ?? '').startsWith('signal:'))
    const nts = signal.find((b) => b.name === 'Note to Self')
    check('the test daemon has a linked account', !!nts)
    if (!nts) return
    await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(nts.id)}, true)`)
    await sleep(2500)
    const log = await ev(`document.querySelector('.message-list, .messages, main')?.innerText ?? document.body.innerText`)
    const count = (selector) => ev(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
    check('a reply shows the message it answers', (await count('.reply-preview')) > 0)
    // Listed rather than drawn: this window's media folder is its own scratch one, not the test daemon's, so a picture
    // the daemon cached is not one it may load. The second moho's own window (moho2.sh window) draws it.
    check('a picture sent from here is on its message', /probe\.png/.test(log))
    check('own messages carry a delivery tick', (await count('.delivery-tick')) > 0)
    check('a disappearing-timer change is a line', /disappearing messages/i.test(log))
    check('a view-once picture sent from here says so', /\[View-once media\]/.test(log))
    await shot('signal-note-to-self.png')

    const stories = signal.find((b) => b.remoteId === 'stories')
    check('there is a Stories conversation', !!stories)
    if (stories) {
      await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(stories.id)}, true)`)
      await sleep(1500)
      await ev(`document.querySelector('button[title="Add to the message"]')?.click()`)
      await sleep(500)
      const menu = await ev(`document.body.innerText`)
      check('Stories offers Post a story', /Post a story/.test(menu))
      await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
      await shot('signal-stories.png')
    }

    const group = signal.find((b) => (b.remoteId ?? '').startsWith('g:'))
    if (group) {
      await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(group.id)}, true)`)
      await sleep(1500)
      await ev(`document.querySelector('button[title="Group settings"]')?.click()`)
      await sleep(2500)
      const settings = await ev(`document.querySelector('.room-settings')?.innerText ?? ''`)
      check('group settings say who can send messages', /Who can send messages/.test(settings))
      check('and list the members', /Members \(/.test(settings))
      await shot('signal-group-settings.png')
    } else {
      console.log('  skip  group settings: the account is in no group')
    }
  })
  console.log('The test daemon stops with the window: start it again with moho2.sh start')
}

const failed = results.filter((ok) => !ok).length
console.log(failed ? `${failed} check(s) failed` : 'all checks ok')
process.exit(failed)
