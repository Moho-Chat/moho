#!/usr/bin/env node
/**
 * Twitch's third-party emotes against the real services, in a scratch moho with no sign-in: a busy channel is
 * joined, and the window must draw BetterTTV, FrankerFaceZ and 7TV emotes in messages as loaded pictures, offer
 * each service as a section of the emoji picker with loaded pictures, and put a picked one into the composer.
 *
 *   node scripts/check-twitch-emotes.mjs <output directory> [channel] [seconds]
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { launchApp, sleep } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
const channel = process.argv[3] ?? 'xqc'
const seconds = Number(process.argv[4] ?? 30)
fs.mkdirSync(out, { recursive: true })
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const ev = (code) => page.evaluate(code)
const shot = async (name) => {
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
}
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
try {
  try {
    const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j']).toString())
    for (const c of clients.filter((c) => /electron|moho/i.test(c.class + c.title))) execFileSync('hyprctl', ['dispatch', 'movetoworkspacesilent', `2,address:${c.address}`])
  } catch {}
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  const rpc = (m, p) => ev(`window.moho.rpc(${JSON.stringify(m)}, ${JSON.stringify(p)}).catch((e) => ({ error: String(e.message || e) }))`)
  const added = await rpc('addTwitchAccount', {})
  await sleep(2500)
  await rpc('joinBuffer', { accountId: added.accountId, name: channel })
  const id = `${added.accountId}|${channel}`
  await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(id)})`)
  await sleep(seconds * 1000)

  const sources = await rpc('listAllEmoji', { bufferId: id })
  say('sections', JSON.stringify(sources.map((s) => [s.id, s.emoji?.length])))
  const body = await ev(`JSON.stringify((window.__mohoShots.state().messagesByBuffer[${JSON.stringify(id)}] || []).map((m) => m.body))`)
  const kinds = {}
  for (const m of body.matchAll(/\[twitch:(emote|aemote|bttv|ffz|7tv):/g)) kinds[m[1]] = (kinds[m[1]] ?? 0) + 1
  say('emote tokens in messages', JSON.stringify(kinds))
  say('pictures in messages', await ev(`JSON.stringify((() => { const all = [...document.querySelectorAll('.message-row img.custom-emoji')]; const by = {}; for (const i of all) { const k = (i.src.match(/betterttv|7tv|frankerfacez|jtvnw/) || ['other'])[0]; by[k] = by[k] || [0, 0]; by[k][0]++; if (i.complete && i.naturalWidth > 0) by[k][1]++ } return by })())`))

  // The picker. The account is anonymous here (no sign-in is used), so the window is told it may talk; the
  // emote lists it asks the daemon for are the real ones.
  await ev(`(() => { const s = window.__mohoShots.store; const st = window.__mohoShots.state(); s.set({ accounts: st.accounts.map((a) => ({ ...a, hasPassword: true, webSession: true })) }) })()`)
  await sleep(800)
  await ev(`document.querySelector('button[title="Emoji"]')?.click()`)
  await sleep(2500)
  await shot('picker.png')
  say('picker pictures', await ev(`JSON.stringify((() => { const all = [...document.querySelectorAll('.emoji-body img, [class*=emoji] img')]; const by = {}; for (const i of all) { const k = (i.src.match(/betterttv|7tv|frankerfacez|jtvnw|^data/) || ['other'])[0]; by[k] = by[k] || [0, 0]; by[k][0]++; if (i.complete && i.naturalWidth > 0) by[k][1]++ } return by })())`))
  await ev(`document.querySelector('.emoji-cell')?.click()`)
  await sleep(600)
  say('after picking the first (BetterTTV) emote, the box holds', await ev(`JSON.stringify({ html: (document.querySelector('[contenteditable=true]')?.innerHTML || '').slice(0, 300), text: document.querySelector('[contenteditable=true]')?.innerText })`))
  await shot('picked.png')
  say('what the picker has', await ev(`JSON.stringify([...document.querySelectorAll('[class*=emoji]')].map((e) => e.className).filter((v, i, a) => a.indexOf(v) === i).slice(0, 30))`))
  say('picker section headings', await ev(`JSON.stringify([...document.querySelectorAll('.emoji-section-title, .emoji-heading, .emoji-body h4, .emoji-body [class*=title]')].map((e) => e.textContent.trim()).slice(0, 20))`))
} finally {
  await stop()
}
