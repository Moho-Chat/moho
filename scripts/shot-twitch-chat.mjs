#!/usr/bin/env node
/**
 * Reads a busy live Twitch channel in a scratch moho with no sign-in, and checks what the window shows:
 * that the channel joins, messages arrive with their colours, badges and emote pictures, replies carry
 * their quote, the room's modes are in the header and the chatters are counted.
 *
 *   node scripts/shot-twitch-chat.mjs <output directory> [channel] [seconds]
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { launchApp, sleep } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
const channel = process.argv[3] ?? 'xqc'
const seconds = Number(process.argv[4] ?? 40)
fs.mkdirSync(out, { recursive: true })
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const ev = (code) => page.evaluate(code)
try {
  try {
    const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j']).toString())
    for (const c of clients.filter((c) => /electron|moho/i.test(c.class + c.title))) execFileSync('hyprctl', ['dispatch', 'movetoworkspacesilent', `2,address:${c.address}`])
  } catch {}
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  const rpc = (m, p) => ev(`window.moho.rpc(${JSON.stringify(m)}, ${JSON.stringify(p)}).catch((e) => ({ error: String(e.message || e) }))`)
  // HISTORY=1 turns on the third-party recent messages, which is off until a person says so.
  if (process.env.HISTORY) await ev(`window.moho.prefs.set('twitch.recentHistory', true)`)
  const added = await rpc('addTwitchAccount', {})
  say('account', JSON.stringify(added))
  await sleep(2500)
  say('accounts', await ev(`JSON.stringify(window.__mohoShots.state().accounts.map((a) => ({ id: a.id, service: a.service, state: a.state, name: a.displayName, hasPassword: a.hasPassword })))`))
  say('join', JSON.stringify(await rpc('joinBuffer', { accountId: added.accountId, name: channel })))
  const id = `${added.accountId}|${channel}`
  await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(id)})`)
  say('a channel that does not exist', JSON.stringify(await rpc('joinBuffer', { accountId: added.accountId, name: 'zzzz_no_such_channel_zzzz' })))
  if (process.env.HISTORY) {
    await sleep(6000)
    say('rows six seconds after opening, with the past', await ev(`(window.__mohoShots.state().messagesByBuffer[${JSON.stringify(id)}] || []).length`))
  }
  await sleep(seconds * 1000)
  say('buffers', await ev(`JSON.stringify(window.__mohoShots.state().buffers.filter((b) => b.accountId === ${JSON.stringify(added.accountId)}).map((b) => ({ id: b.id, modes: b.channelModes })))`))
  say('page', await ev(`JSON.stringify({
    rows: document.querySelectorAll('.message-row').length,
    emotes: document.querySelectorAll('.message-row img.custom-emoji').length,
    emotesLoaded: [...document.querySelectorAll('.message-row img.custom-emoji')].filter((i) => i.complete && i.naturalWidth > 0).length,
    badges: [...new Set([...document.querySelectorAll('.message-row .sender-badge')].map((b) => b.textContent))],
    badgePictures: document.querySelectorAll('.message-row .sender-badge-image').length,
    badgePicturesLoaded: [...document.querySelectorAll('.message-row .sender-badge-image')].filter((i) => i.complete && i.naturalWidth > 0).length,
    badgeTitles: [...new Set([...document.querySelectorAll('.message-row .sender-badge-image')].map((i) => i.title))].slice(0, 6),
    emoteSources: [...new Set([...document.querySelectorAll('.message-row img.custom-emoji')].map((i) => new URL(i.src).hostname))],
    replies: document.querySelectorAll('.message-row .reply-preview').length,
    header: document.querySelector('.nicklist-header span')?.textContent,
    coloured: document.querySelectorAll('.message-row .message-from[style*="color"]').length
  })`))
  await shot('twitch-chat.png')
  async function shot(name) {
    const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
  }
} finally {
  await stop()
}
