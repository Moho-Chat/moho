#!/usr/bin/env node
/**
 * Watches a live Kick stream in a scratch moho and reports every time the picture waits for data: when,
 * for how long, and how much was buffered ahead of the playhead just before.
 *
 *   node scripts/watch-kick-stalls.mjs [channel] [seconds]
 */
import { execFileSync } from 'node:child_process'
import { launchApp, sleep } from './lib/harness.mjs'

const channel = process.argv[2] ?? 'spreen'
const seconds = Number(process.argv[3] ?? 90)
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const ev = (code) => page.evaluate(code)
try {
  try {
    const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j']).toString())
    for (const c of clients.filter((c) => /electron|moho/i.test(c.class + c.title))) execFileSync('hyprctl', ['dispatch', 'movetoworkspacesilent', `2,address:${c.address}`])
  } catch {}
  await sleep(2500)
  const rpc = (m, p) => ev(`window.moho.rpc(${JSON.stringify(m)}, ${JSON.stringify(p)}).catch((e) => ({ error: String(e.message || e) }))`)
  const added = await rpc('addKickAccount', {})
  await rpc('joinBuffer', { accountId: added.accountId, name: channel })
  const id = `${added.accountId}|${channel}`
  for (let i = 0; i < 40; i++) {
    await sleep(1000)
    if (await ev(`!!window.__mohoShots.state().kickStreams[${JSON.stringify(id)}]?.playbackUrl`)) break
  }
  await ev(`(async () => { await window.__mohoShots.store.selectBuffer(${JSON.stringify(id)}); window.__mohoShots.store.watchStream(${JSON.stringify(id)}) })()`)
  for (let i = 0; i < 40; i++) {
    if (await ev(`!!document.querySelector('video.video-tile-picture')`)) break
    await sleep(500)
  }
  await ev(`(() => {
    const v = document.querySelector('video.video-tile-picture')
    const log = (window.__stalls = { events: [], samples: [], t0: performance.now() })
    const at = () => +((performance.now() - log.t0) / 1000).toFixed(1)
    const ahead = () => { const b = v.buffered; return b.length ? +(b.end(b.length - 1) - v.currentTime).toFixed(2) : 0 }
    for (const n of ['waiting', 'stalled', 'playing', 'seeking', 'seeked', 'ratechange']) v.addEventListener(n, () => log.events.push({ t: at(), n, ahead: ahead(), rate: v.playbackRate, ct: +v.currentTime.toFixed(2) }))
    setInterval(() => log.samples.push({ t: at(), ahead: ahead(), ct: +v.currentTime.toFixed(2), rate: v.playbackRate }), 500)
  })()`)
  await sleep(seconds * 1000)
  const r = JSON.parse(await ev('JSON.stringify(window.__stalls)'))
  const waits = r.events.filter((e) => e.n === 'waiting')
  console.log(`${waits.length} waiting events in ${seconds}s`)
  for (const e of r.events) console.log(JSON.stringify(e))
  const a = r.samples.map((s) => s.ahead)
  console.log('buffer ahead: min', Math.min(...a), 'max', Math.max(...a), 'mean', +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2))
  console.log('rates seen', [...new Set(r.samples.map((s) => s.rate))])
  console.log('quality', await ev(`JSON.stringify((() => { const q = document.querySelector('video.video-tile-picture').getVideoPlaybackQuality(); return { dropped: q.droppedVideoFrames, total: q.totalVideoFrames } })())`))
} finally {
  await stop()
}
