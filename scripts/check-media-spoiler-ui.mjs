#!/usr/bin/env node
/**
 * Hiding a picture behind a spoiler after it was sent, in a scratch moho with injected state (nothing is contacted): the
 * button on a picture's corner while it is pointed at, and the right-click entry, both ways - hide it here, and take it off.
 *
 *   node scripts/check-media-spoiler-ui.mjs <output directory>
 */
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, sleep } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const ev = (code) => page.evaluate(code)
const shot = async (name) => {
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
}
const results = []
const check = (what, ok, detail = '') => {
  results.push(ok)
  console.log(ok ? '  ok  ' : '  FAIL', what, detail)
}
try {
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false })
  await ev(`(() => {
    const s = window.__mohoShots.store
    const acct = { id: 'discord:me', service: 'discord', name: 'me', host: '', port: 0, state: 'connected', nick: 'me' }
    const pic = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#d6735c"/><circle cx="160" cy="100" r="60" fill="#fff"/></svg>')
    const buffer = { id: 'discord:me|g/#pics', accountId: 'discord:me', kind: 'channel', name: 'g/#pics', lastActivityTs: 5, groupId: 'discord:me|guild', category: 'Channels' }
    const t = Math.floor(Date.now() / 1000) - 300
    const m = (i, name) => ({ id: 'msg' + i, bufferId: buffer.id, from: 'poster', body: '', ts: t + i * 20, kind: 'chat', isAction: false, isHighlight: false, isOwn: false, edited: false,
      attachments: [{ kind: 'image', filename: name, url: pic, width: 320, height: 200, mimetype: 'image/svg+xml' }] })
    s.set({ accounts: [acct], groups: [{ id: 'discord:me|guild', accountId: 'discord:me', service: 'discord', kind: 'guild', name: 'G', position: 0 }], buffers: [buffer],
      messagesByBuffer: { [buffer.id]: [m(1, 'plain.png'), m(2, 'SPOILER_theirs.png')] }, activeBufferId: buffer.id })
    s.selectGroup('discord:me|guild')
  })()`)
  await sleep(1500)
  const wraps = () => ev(`document.querySelectorAll('.media-embed-wrap').length`)
  check('two pictures are drawn, one hidden by its sender', (await wraps()) === 2 && (await ev(`document.querySelectorAll('.media-embed-wrap.spoilered').length`)) === 1)
  check('the button is on the open one and not the covered one', (await ev(`document.querySelectorAll('.media-spoiler-button').length`)) === 1)

  // Pointed at, the button shows; pressing it covers the picture.
  const box = await ev(`(() => { const r = document.querySelector('.media-embed-wrap:not(.spoilered)').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y })
  await sleep(400)
  const seenButton = await ev(`JSON.stringify([getComputedStyle(document.querySelector('.media-spoiler-button')).opacity, document.querySelector('.media-embed-wrap:not(.spoilered)').matches(':hover'), String(document.elementFromPoint(${box.x}, ${box.y})?.className)])`)
  check('pointed at, the button can be seen', JSON.parse(seenButton)[0] === '1', seenButton)
  await shot('media-spoiler-hover.png')
  await ev(`document.querySelector('.media-spoiler-button').click()`)
  await sleep(300)
  check('pressing it hides the picture here', (await ev(`document.querySelectorAll('.media-embed-wrap.spoilered').length`)) === 2)
  const kept = await ev(`window.moho.prefs.getAll().then((p) => JSON.stringify(p.localSpoilers))`)
  check('and it is kept', /msg1/.test(kept), kept)

  // Right click on a hidden picture: take it off; on an open one: put it on.
  const rightClick = async (selector) => {
    const b = await ev(`(() => { const r = document.querySelectorAll(${JSON.stringify(selector)})[0].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
    await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'right', clickCount: 1 })
    await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'right', clickCount: 1 })
    await sleep(400)
    return ev(`[...document.querySelectorAll('.context-menu-item')].map((b) => b.textContent.trim())`)
  }
  const onHidden = await rightClick('.media-embed-wrap.spoilered')
  check('right click on one hidden here offers to take that off', onHidden.some((t) => /Remove local spoiler/.test(t)), JSON.stringify(onHidden.slice(0, 3)))
  await shot('media-spoiler-menu.png')
  await ev(`[...document.querySelectorAll('.context-menu-item')].find((b) => /Remove local spoiler/.test(b.textContent)).click()`)
  await sleep(300)
  check('which uncovers it', (await ev(`document.querySelectorAll('.media-embed-wrap.spoilered').length`)) === 1)
  const onOpen = await rightClick('.media-embed-wrap:not(.spoilered)')
  check('right click on an open one offers Spoiler Media (Local)', onOpen.some((t) => /Spoiler Media \(Local\)/.test(t)), JSON.stringify(onOpen.slice(0, 3)))
  check('and no moderator entry, since no service lets a file in somebody else’s message be marked', !onOpen.some((t) => /Moderator/.test(t)))
  await ev(`[...document.querySelectorAll('.context-menu-item')].find((b) => /Spoiler Media \\(Local\\)/.test(b.textContent)).click()`)
  await sleep(300)
  check('choosing it hides the picture', (await ev(`document.querySelectorAll('.media-embed-wrap.spoilered').length`)) === 2)
  // The sender's own spoiler, opened, can be covered again from the corner.
  await ev(`document.querySelectorAll('.media-embed-wrap.spoilered')[1].dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await sleep(300)
  check('a spoiler opened by clicking can be covered again from its corner', (await ev(`document.querySelectorAll('.media-spoiler-button').length`)) >= 1)
} finally {
  await stop()
  console.log(results.every(Boolean) ? 'ALL OK' : 'SOME FAILED')
  process.exitCode = results.every(Boolean) ? 0 : 1
}
