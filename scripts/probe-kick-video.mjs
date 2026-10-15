#!/usr/bin/env node
/**
 * Plays a live Kick stream with several hls.js configurations, one after the other, in the app's own
 * Chromium, and says for each how far behind the broadcaster it ran, how often it stopped to wait,
 * and how many frames it dropped. Nothing is signed in: the playlist is public.
 *
 *   node scripts/probe-kick-video.mjs [channel] [seconds]      (defaults: spreen, 75)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { launchApp, sleep } from './lib/harness.mjs'

const channel = process.argv[2] ?? 'spreen'
const seconds = Number(process.argv[3] ?? 75)
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-video-'))
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [path.join(root, 'scripts/lib/hlsprobe.ts'), '--bundle', '--format=iife', `--outfile=${path.join(work, 'probe.js')}`, '--log-level=error'])
fs.writeFileSync(path.join(work, 'probe.html'), '<!doctype html><body style="margin:0"><video id="v" width="1280" height="720" autoplay muted playsinline></video><script src="probe.js"></script></body>')

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const playlist = async () => {
  const r = await fetch(`https://kick.com/api/v2/channels/${channel}/playback-url`, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  return (await r.json()).data
}

const base = { capLevelToPlayerSize: true }
const configs = [
  { name: 'as it is now (3 target durations, no prefetch)', prefetch: 0, hls: { ...base, liveSyncDurationCount: 3 } },
  { name: 'seconds: sync 4s, no prefetch', prefetch: 0, hls: { ...base, liveSyncDuration: 4, liveMaxLatencyDuration: 10 } },
  { name: 'prefetch 2, sync 4s', prefetch: 2, hls: { ...base, liveSyncDuration: 4, liveMaxLatencyDuration: 10 } },
  { name: 'prefetch 2, sync 3s, catch-up 1.1', prefetch: 2, hls: { ...base, liveSyncDuration: 3, liveMaxLatencyDuration: 8, maxLiveSyncPlaybackRate: 1.1 } },
  { name: 'prefetch 1, sync 3s, catch-up 1.1', prefetch: 1, hls: { ...base, liveSyncDuration: 3, liveMaxLatencyDuration: 8, maxLiveSyncPlaybackRate: 1.1 } },
  { name: 'prefetch 2, sync 5s, catch-up 1.1', prefetch: 2, hls: { ...base, liveSyncDuration: 5, liveMaxLatencyDuration: 10, maxLiveSyncPlaybackRate: 1.1 } }
]
if (process.env.LIST === 'steady') {
  configs.length = 0
  configs.push(
    { name: 'prefetch 2, sync 3s', prefetch: 2, hls: { ...base, liveSyncDuration: 3, liveMaxLatencyDuration: 10 } },
    { name: 'prefetch 2, sync 4s', prefetch: 2, hls: { ...base, liveSyncDuration: 4, liveMaxLatencyDuration: 10 } },
    { name: 'prefetch 2, sync 5s', prefetch: 2, hls: { ...base, liveSyncDuration: 5, liveMaxLatencyDuration: 10 } }
  )
}
const only = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null

const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
try {
  try {
    const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j']).toString())
    for (const c of clients.filter((c) => /electron|moho/i.test(c.class + c.title))) execFileSync('hyprctl', ['dispatch', 'movetoworkspacesilent', `2,address:${c.address}`])
  } catch {}
  await sleep(2500)
  await page.call('Page.navigate', { url: `file://${path.join(work, 'probe.html')}` })
  await sleep(1500)
  for (const [i, cfg] of configs.entries()) {
    if (only && !only.includes(i)) continue
    const url = await playlist()
    const out = await page.evaluate(`window.runProbe(${JSON.stringify({ ...cfg, url, seconds, cap: 720 })})`)
    console.log(JSON.stringify(out))
  }
} finally {
  await stop()
}
