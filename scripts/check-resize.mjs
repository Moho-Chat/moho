#!/usr/bin/env node
/**
 * The edges that can be dragged, in a scratch moho with injected state (nothing is contacted): the channel list
 * and the member list change width and keep it, double-click puts them back, a stream above the conversation
 * changes height by its bottom edge, and the corner panel changes size from every edge and corner.
 *
 *   node scripts/check-resize.mjs <output directory>
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
const mouse = (type, x, y) => page.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 })
const drag = async (from, to) => {
  await mouse('mouseMoved', from.x, from.y)
  await mouse('mousePressed', from.x, from.y)
  for (let i = 1; i <= 6; i++) await mouse('mouseMoved', from.x + ((to.x - from.x) * i) / 6, from.y + ((to.y - from.y) * i) / 6)
  await mouse('mouseReleased', to.x, to.y)
  await sleep(300)
}
const rect = (sel) => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r ? { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom } : null })()`)
const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
try {
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await ev(`(() => {
    const s = window.__mohoShots.store
    const acct = { id: 'twitch:me', service: 'twitch', name: 'me', host: '', port: 0, state: 'connected', hasPassword: true, nick: 'me' }
    const mk = (name) => ({ id: 'twitch:me|' + name, accountId: 'twitch:me', kind: 'channel', name, lastActivityTs: 5, category: 'Channels', groupId: 'account:twitch:me' })
    const t = Math.floor(Date.now() / 1000) - 600
    const messages = Array.from({ length: 8 }, (_, i) => ({ id: 'm' + i, bufferId: 'twitch:me|xqc', from: 'user' + i, body: 'hello ' + i, ts: t + i * 20, kind: 'chat', isAction: false, isHighlight: false, isOwn: false, edited: false }))
    s.set({ accounts: [acct], groups: [{ id: 'account:twitch:me', accountId: 'twitch:me', service: 'twitch', kind: 'account', name: 'me', position: 0 }], buffers: [mk('xqc'), mk('other')], messagesByBuffer: { 'twitch:me|xqc': messages }, activeBufferId: 'twitch:me|xqc' })
    s.selectGroup('account:twitch:me')
  })()`)
  await sleep(1200)

  console.log('Channel list')
  let side = await rect('.sidebar')
  const divider = await rect('.divider-v.resizer')
  check('the divider beside the channel list can be taken', !!divider, JSON.stringify(divider))
  const before = side.w
  await drag(centre(divider), { x: centre(divider).x + 90, y: centre(divider).y })
  side = await rect('.sidebar')
  check('dragging it wider widens the channel list', Math.abs(side.w - (before + 90)) <= 2, `${before} -> ${side.w}`)
  await drag(centre(await rect('.divider-v.resizer')), { x: 5, y: 300 })
  side = await rect('.sidebar')
  check('it stops at its narrowest', side.w >= 158 && side.w <= 162, String(side.w))
  await ev(`document.querySelector('.divider-v.resizer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await sleep(300)
  side = await rect('.sidebar')
  check('double-click puts it back to its usual width', Math.abs(side.w - 220) <= 2, String(side.w))
  console.log('Member list')
  await ev(`window.__mohoShots.store.set({ roster: {} })`)
  const nick = await rect('.nicklist-pane')
  if (nick) {
    const handles = await ev(`[...document.querySelectorAll('.divider-v.resizer')].map((d) => { const r = d.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })`)
    const right = handles[handles.length - 1]
    const w0 = nick.w
    await drag(right, { x: right.x - 70, y: right.y })
    const w1 = (await rect('.nicklist-pane')).w
    check('dragging the member list divider left widens the member list', Math.abs(w1 - (w0 + 70)) <= 2, `${w0} -> ${w1}`)
  } else check('the member list is shown for a channel', false)
  await shot('columns.png')

  console.log('Stream above the conversation')
  await ev(`(() => {
    const s = window.__mohoShots.store
    s.set({ watching: { bufferId: 'twitch:me|xqc', accountId: 'twitch:me', title: 'xqc' }, kickStreams: { 'twitch:me|xqc': { bufferId: 'twitch:me|xqc', live: true, title: 'a stream', viewers: 5, playbackUrl: '' } } })
  })()`)
  await sleep(800)
  const edge = await rect('.call-stage:not(.pip) .stage-resize')
  check('the stream has a bottom edge to take', !!edge, JSON.stringify(edge))
  if (edge) {
    const h0 = (await rect('.video-stage')).h
    await drag(centre(edge), { x: centre(edge).x, y: centre(edge).y - 60 })
    const h1 = (await rect('.video-stage')).h
    check('dragging it up makes the picture shorter', h1 < h0 - 40, `${h0} -> ${h1}`)
    await shot('stream-inline.png')
  }

  console.log('Corner panel')
  await ev(`window.__mohoShots.store.selectBuffer('twitch:me|other')`)
  await sleep(800)
  let pip = await rect('.call-stage.pip')
  check('the stream goes to a corner when another channel is open', !!pip, JSON.stringify(pip))
  if (pip) {
    for (const [dir, dx, dy, bigger] of [['l', -80, 0, true], ['t', 0, -60, true], ['tl', -60, -40, true], ['r', 60, 0, true], ['b', 0, 50, true]]) {
      const was = (await rect('.call-stage.pip')).w
      const handle = await rect(`.call-stage.pip .edge-${dir}`)
      if (!handle) { check(`the ${dir} edge can be taken`, false); continue }
      const start = centre(handle)
      await drag(start, { x: start.x + dx, y: start.y + dy })
      const now = await rect('.call-stage.pip')
      check(`dragging the ${dir} edge changes the corner panel's size`, bigger ? now.w > was + 20 : now.w < was - 20, `${Math.round(was)} -> ${Math.round(now.w)}`)
      check(`...and it stays inside the window (${dir})`, now.x >= 0 && now.r <= 1280 && now.y >= 0 && now.b <= 800, JSON.stringify(now))
    }
    await shot('pip.png')
  }
} finally {
  await stop()
  console.log(results.every(Boolean) ? 'ALL OK' : 'SOME FAILED')
  process.exitCode = results.every(Boolean) ? 0 : 1
}
