#!/usr/bin/env node
/**
 * Watches a real live stream in a scratch moho with no account signed in, and checks the stage's own
 * controls (#339): that they come up over the picture and go away again, that pausing says so and
 * the LIVE pill brings it back, how far behind it runs, theatre mode, and full screen. Photographs each.
 *
 *   node scripts/shot-stream-stage.mjs <output directory> [twitch|kick] [channel]
 *
 * With no channel, the busiest one on Twitch at the moment.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { launchApp, sleep } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
const service = process.argv[3] ?? 'twitch'
let channel = process.argv[4]
if (!channel) {
  const top = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko' },
    body: JSON.stringify({ query: 'query{streams(first:5){edges{node{broadcaster{login}}}}}' })
  }).then((r) => r.json())
  channel = top.data.streams.edges[0].node.broadcaster.login
}
fs.mkdirSync(out, { recursive: true })
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const ev = (code) => page.evaluate(code)
const shot = async (name) => {
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
}
const mouse = (x, y) => page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
const press = (title) => ev(`(() => { const b = document.querySelector('.stream-bar button[title^=${JSON.stringify(title)}]'); if (!b || b.disabled) return false; b.click(); return true })()`)
const video = (expr) => ev(`(() => { const v = document.querySelector('video.video-tile-picture'); return v ? (${expr}) : null })()`)
const state = () => ev(`JSON.stringify({ up: !!document.querySelector('.stream-tile.controls-up'), pill: document.querySelector('.stream-live')?.textContent, latency: window.__mohoHls ? +window.__mohoHls.latency.toFixed(1) : null, target: window.__mohoHls?.targetLatency, sidebar: !!document.querySelector('.sidebar, .buffer-list'), tile: document.querySelector('.stream-tile')?.getBoundingClientRect().width, full: !!document.fullscreenElement })`)
try {
  try {
    const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j']).toString())
    for (const c of clients.filter((c) => /electron|moho/i.test(c.class + c.title))) execFileSync('hyprctl', ['dispatch', 'movetoworkspacesilent', `2,address:${c.address}`])
  } catch {}
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  const rpc = (m, p) => ev(`window.moho.rpc(${JSON.stringify(m)}, ${JSON.stringify(p)}).catch((e) => ({ error: String(e.message || e) }))`)
  const added = await rpc(service === 'twitch' ? 'addTwitchAccount' : 'addKickAccount', {})
  say('join', channel, JSON.stringify(await rpc('joinBuffer', { accountId: added.accountId, name: channel })))
  const id = `${added.accountId}|${channel}`
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    if (await ev(`!!window.__mohoShots.state().kickStreams[${JSON.stringify(id)}]?.playbackUrl`)) break
  }
  await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(id)})`)
  await sleep(1500)
  await shot('header-live.png')
  await ev(`window.__mohoShots.store.watchStream(${JSON.stringify(id)})`)
  for (let i = 0; i < 60; i++) {
    if ((await video('v.readyState >= 3 && v.currentTime > 1')) === true) break
    await sleep(500)
  }
  say('playing', JSON.stringify(await video('({ t: +v.currentTime.toFixed(1), w: v.videoWidth, h: v.videoHeight, paused: v.paused })')))
  await sleep(6000)
  await mouse(10, 780)
  await sleep(3600)
  say('pointer away', await state())
  await shot('stage-clean.png')
  await mouse(640, 300)
  await mouse(650, 310)
  await sleep(500)
  say('pointer over', await state())
  await shot('stage-controls.png')

  say('pause', await press('Pause'))
  await sleep(9000)
  await mouse(640, 300)
  say('paused 9s', await state(), JSON.stringify(await video('({ paused: v.paused })')))
  await shot('stage-paused.png')
  say('play', await press('Play'))
  await sleep(4000)
  await mouse(645, 300)
  say('playing again, behind', await state())
  await shot('stage-behind.png')
  say('go live', await ev(`(() => { const b = document.querySelector('.stream-live'); if (!b || b.disabled) return 'pill not offering'; b.click(); return 'clicked' })()`))
  await sleep(6000)
  await mouse(640, 305)
  say('after go live', await state(), JSON.stringify(await video('({ paused: v.paused, ready: v.readyState })')))

  say('theatre', await press('Theatre'))
  await sleep(1200)
  await mouse(640, 300)
  await sleep(400)
  say('in theatre', await state())
  await shot('stage-theatre.png')
  say('leave theatre', await press('Leave theatre'))
  await sleep(800)

  // Keys, with the picture focused.
  await ev(`document.querySelector('.stream-tile').focus()`)
  const key = (k, code) => page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code }).then(() => page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code }))
  await key('m', 'KeyM')
  await sleep(300)
  say('after M', JSON.stringify(await video('({ muted: v.muted })')))
  await key('m', 'KeyM')
  await key(' ', 'Space')
  await sleep(300)
  say('after Space', JSON.stringify(await video('({ paused: v.paused })')))
  await key(' ', 'Space')
  await sleep(300)
  // Full screen needs a gesture: a real click on the button.
  const at = JSON.parse(await ev(`(() => { const r = document.querySelector('.stream-bar button[title^="Full screen"]').getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`))
  for (const type of ['mousePressed', 'mouseReleased']) await page.call('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 })
  await sleep(1500)
  say('full screen', await state())
  await shot('stage-fullscreen.png')
  await ev(`document.fullscreenElement && document.exitFullscreen()`)
  await sleep(800)

  // The corner, when the conversation is left.
  await ev(`window.__mohoShots.store.setActivePanel('settings')`)
  await sleep(1500)
  const pip = JSON.parse(await ev(`(() => { const r = document.querySelector('.call-stage.pip .stream-tile')?.getBoundingClientRect(); return JSON.stringify(r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null) })()`))
  if (pip) await mouse(pip.x, pip.y)
  await sleep(500)
  await shot('stage-corner.png')

  // The small window kept over everything else: whether it opens, and what the compositor makes of it.
  await ev(`(async () => { window.__mohoShots.store.setActivePanel(''); await window.__mohoShots.store.selectBuffer(${JSON.stringify(id)}) })()`)
  await sleep(1200)
  await mouse(640, 300)
  await sleep(300)
  say('picture-in-picture', await press('Picture-in-picture'))
  await sleep(2500)
  try {
    const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j']).toString())
    const top = clients.filter((c) => /picture-in-picture/i.test(c.title))
    say('on-top window', JSON.stringify(top.map((c) => ({ title: c.title, size: c.size, floating: c.floating, pinned: c.pinned, xwayland: c.xwayland }))))
    for (const c of top) try { execFileSync('hyprctl', ['dispatch', 'movetoworkspacesilent', `2,address:${c.address}`]) } catch {}
  } catch (e) {
    say('could not ask the compositor', String(e))
  }
  say('state', await ev(`JSON.stringify({ poppedOut: window.__mohoShots.state().streamPoppedOut, onTop: window.__mohoShots.state().streamOnTop, inline: !!document.querySelector('.main-column .stream-tile') })`))
  await ev(`window.__mohoShots.store.setStreamPoppedOut(false)`)
  await sleep(1000)
} finally {
  await stop()
}
