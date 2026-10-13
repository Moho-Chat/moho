#!/usr/bin/env node
/**
 * Watches a real live Kick stream in a scratch moho with no account signed in, and checks what the
 * player does: that it plays, how far behind it runs, that the resolution menu changes the picture, that
 * the CC button shows the captions, and that the player is built once and not again as the address is
 * renewed. Photographs the stream, each menu and the captions.
 *
 *   node scripts/shot-kick-stream.mjs <output directory> [channel] [idle seconds]
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { launchApp, sleep } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
const channel = process.argv[3] ?? 'spreen'
const idle = Number(process.argv[4] ?? 60)
fs.mkdirSync(out, { recursive: true })
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const ev = (code) => page.evaluate(code)
const shot = async (name) => {
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
}
const click = (selector) => ev(`(() => { const b = document.querySelector(${JSON.stringify(selector)}); if (!b || b.disabled) return false; b.click(); return true })()`)
const video = (expr) => ev(`(() => { const v = document.querySelector('video.video-tile-picture'); return v ? (${expr}) : null })()`)
try {
  try {
    const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j']).toString())
    for (const c of clients.filter((c) => /electron|moho/i.test(c.class + c.title))) execFileSync('hyprctl', ['dispatch', 'movetoworkspacesilent', `2,address:${c.address}`])
  } catch {}
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  const rpc = (m, p) => ev(`window.moho.rpc(${JSON.stringify(m)}, ${JSON.stringify(p)}).catch((e) => ({ error: String(e.message || e) }))`)
  const added = await rpc('addKickAccount', {})
  say('account', JSON.stringify(added))
  say('join', JSON.stringify(await rpc('joinBuffer', { accountId: added.accountId, name: channel })))
  const id = `${added.accountId}|${channel}`
  let live = null
  for (let i = 0; i < 40 && !live?.playbackUrl; i++) {
    await sleep(1000)
    live = await ev(`window.__mohoShots.state().kickStreams[${JSON.stringify(id)}] || null`)
  }
  say('stream', JSON.stringify({ live: live?.live, hasUrl: !!live?.playbackUrl, expires: live?.playbackExpires, livestreamId: live?.livestreamId }))
  await ev(`(async () => { await window.__mohoShots.store.selectBuffer(${JSON.stringify(id)}); window.__mohoShots.store.watchStream(${JSON.stringify(id)}) })()`)
  for (let i = 0; i < 40; i++) {
    if ((await video('v.readyState >= 3 && v.currentTime > 1')) === true) break
    await sleep(500)
  }
  say('playing', await video('({ t: v.currentTime, w: v.videoWidth, h: v.videoHeight, paused: v.paused })').then(JSON.stringify))
  await sleep(4000)
  await shot('stream-playing.png')

  // Resolution.
  say('quality menu', await click('button[title^="Resolution"]'))
  await sleep(400)
  say('quality choices', JSON.stringify(await ev(`[...document.querySelectorAll('.stream-menu .context-menu-item')].map((b) => b.textContent.trim())`)))
  await shot('stream-quality-menu.png')
  for (const want of ['480p', 'Auto']) {
    await ev(`(() => { const b = [...document.querySelectorAll('.stream-menu .context-menu-item')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(want)})); b && b.click() })()`)
    await sleep(8000)
    say(`after choosing ${want}`, JSON.stringify(await video('({ h: v.videoHeight, t: +v.currentTime.toFixed(1) })')), JSON.stringify(await ev(`document.querySelector('button[title^="Resolution"]')?.title`)))
    if (want === '480p') await click('button[title^="Resolution"]')
  }

  // Captions.
  say('captions button', await ev(`JSON.stringify({ title: document.querySelector('button[title*="aptions"]')?.title, disabled: document.querySelector('button[title*="aptions"]')?.disabled })`))
  say('captions menu', await click('button[title*="aptions"]'))
  await sleep(400)
  say('caption choices', JSON.stringify(await ev(`[...document.querySelectorAll('.stream-menu .context-menu-item')].map((b) => b.textContent.trim())`)))
  await shot('stream-captions-menu.png')
  await ev(`(() => { const b = [...document.querySelectorAll('.stream-menu .context-menu-item')].find((x) => x.textContent.trim() === 'English'); b && b.click() })()`)
  await sleep(15000)
  say('text tracks', await video(`JSON.stringify([...v.textTracks].map((t) => ({ lang: t.language, mode: t.mode, cues: t.cues ? t.cues.length : 0 })))`))
  await shot('stream-captions-on.png')
  say('captions button now', await ev(`document.querySelector('button[title*="aptions"]')?.title`))

  // Built once.
  const sources = new Set()
  const began = Date.now()
  while (Date.now() - began < idle * 1000) {
    sources.add(await video('v.src'))
    await sleep(1000)
  }
  const later = await ev(`window.__mohoShots.state().kickStreams[${JSON.stringify(id)}]`)
  say(`over ${idle}s: ${sources.size} player source(s); address expires`, later?.playbackExpires, 'changed:', later?.playbackUrl !== live?.playbackUrl)
  say('quality', JSON.stringify(await video('(() => { const q = v.getVideoPlaybackQuality(); return { dropped: q.droppedVideoFrames, total: q.totalVideoFrames } })()')))
} finally {
  await stop()
}
