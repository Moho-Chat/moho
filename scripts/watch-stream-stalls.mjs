#!/usr/bin/env node
/**
 * Watches a live stream of either service in a scratch moho and reports how it plays: every time the
 * picture waits for data, how much was buffered ahead of the playhead, how far behind the stream's own
 * clock it runs, what rendition it settled on, and whether an ad break was marked.
 *
 *   node scripts/watch-stream-stalls.mjs <kick|twitch> <channel> [seconds]
 */
import { execFileSync } from 'node:child_process'
import { launchApp, sleep } from './lib/harness.mjs'

const service = process.argv[2] ?? 'twitch'
const channel = process.argv[3] ?? 'xqc'
const seconds = Number(process.argv[4] ?? 90)
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const ev = (code) => page.evaluate(code)
try {
  try {
    const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j']).toString())
    for (const c of clients.filter((c) => /electron|moho/i.test(c.class + c.title))) execFileSync('hyprctl', ['dispatch', 'movetoworkspacesilent', `2,address:${c.address}`])
  } catch {}
  await sleep(2500)
  const rpc = (m, p) => ev(`window.moho.rpc(${JSON.stringify(m)}, ${JSON.stringify(p)}).catch((e) => ({ error: String(e.message || e) }))`)
  const added = await rpc(service === 'twitch' ? 'addTwitchAccount' : 'addKickAccount', {})
  const accountId = added.accountId
  console.log('join', JSON.stringify(await rpc('joinBuffer', { accountId, name: channel })))
  const id = `${accountId}|${channel}`
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    if (await ev(`!!window.__mohoShots.state().kickStreams[${JSON.stringify(id)}]?.playbackUrl`)) break
  }
  const stream = JSON.parse(await ev(`JSON.stringify((({ live, title, category, viewers, playbackExpires, adFree, playbackError }) => ({ live, title, category, viewers, playbackExpires, adFree, playbackError }))(window.__mohoShots.state().kickStreams[${JSON.stringify(id)}] || {}))`))
  console.log('stream', JSON.stringify(stream))
  if (!stream.live) { console.log('not live; nothing to watch'); process.exit(0) }
  await ev(`(async () => { await window.__mohoShots.store.selectBuffer(${JSON.stringify(id)}); window.__mohoShots.store.watchStream(${JSON.stringify(id)}) })()`)
  for (let i = 0; i < 40; i++) {
    if (await ev(`!!document.querySelector('video.video-tile-picture') && window.__mohoHls?.levels?.length > 0`)) break
    await sleep(500)
  }
  // The stream's own clock against ours, from the playlist's session data.
  const offset = await ev(`(async () => { const u = window.__mohoShots.state().kickStreams[${JSON.stringify(id)}].playbackUrl; const t0 = Date.now(); const r = await fetch(u); const m = /SERVER-TIME",VALUE="([0-9.]+)"/.exec(await r.text()); return m ? Number(m[1]) * 1000 - (t0 + Date.now()) / 2 : null })().catch(() => null)`)
  console.log('clock offset ms', offset)
  await ev(`(() => {
    const v = document.querySelector('video.video-tile-picture')
    const log = (window.__stalls = { events: [], samples: [], t0: performance.now() })
    const at = () => +((performance.now() - log.t0) / 1000).toFixed(1)
    const ahead = () => { const b = v.buffered; return b.length ? +(b.end(b.length - 1) - v.currentTime).toFixed(2) : 0 }
    for (const n of ['waiting', 'stalled', 'seeking', 'ratechange']) v.addEventListener(n, () => log.events.push({ t: at(), n, ahead: ahead(), ct: +v.currentTime.toFixed(2) }))
    setInterval(() => {
      const h = window.__mohoHls
      log.samples.push({ t: at(), ahead: ahead(), latency: h?.playingDate && ${offset === null ? 'null' : offset} !== null ? +((Date.now() + ${offset ?? 0} - h.playingDate.getTime()) / 1000).toFixed(1) : null, level: h?.currentLevel, height: v.videoHeight, ad: !!document.querySelector('.stream-ad') })
    }, 500)
  })()`)
  if (process.env.SHOT_DIR) {
    // Photographs the stage, then its resolution menu, part-way through.
    const fs = await import('node:fs')
    const shot = async (name) => {
      const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(`${process.env.SHOT_DIR}/${name}`, Buffer.from(data, 'base64'))
    }
    await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
    await sleep(Math.min(20, seconds / 2) * 1000)
    await shot(`${service}-stream.png`)
    await ev(`document.querySelector('button[title^="Resolution"]')?.click()`)
    await sleep(500)
    console.log('quality choices', await ev(`JSON.stringify([...document.querySelectorAll('.stream-menu .context-menu-item')].map((b) => b.textContent.trim()))`))
    await shot(`${service}-stream-quality.png`)
    await ev(`document.querySelector('.stream-menu-scrim')?.click()`)
    await sleep((seconds - Math.min(20, seconds / 2)) * 1000 - 500)
  } else {
    await sleep(seconds * 1000)
  }
  const r = JSON.parse(await ev('JSON.stringify(window.__stalls)'))
  const waits = r.events.filter((e) => e.n === 'waiting' && e.t > 6)
  console.log(`${waits.length} waiting events after the first six seconds, over ${seconds}s`)
  for (const e of r.events.filter((e) => e.t > 6)) console.log(JSON.stringify(e))
  const a = r.samples.map((s) => s.ahead)
  const lat = r.samples.map((s) => s.latency).filter((x) => x !== null)
  console.log('buffer ahead: min', Math.min(...a), 'max', Math.max(...a), 'mean', +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2))
  if (lat.length) console.log('behind the stream: min', Math.min(...lat), 'max', Math.max(...lat), 'mean', +(lat.reduce((x, y) => x + y, 0) / lat.length).toFixed(1))
  console.log('heights', [...new Set(r.samples.map((s) => s.height))], 'ad breaks seen', r.samples.some((s) => s.ad))
  console.log('quality', await ev(`JSON.stringify((() => { const q = document.querySelector('video.video-tile-picture').getVideoPlaybackQuality(); return { dropped: q.droppedVideoFrames, total: q.totalVideoFrames } })())`))
} finally {
  await stop()
}
