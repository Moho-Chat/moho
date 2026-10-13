#!/usr/bin/env node
/**
 * Signing in to Steam by scanning a QR code with the phone app, through the window as a person
 * does it: a scratch app with no accounts, Accounts -> Steam -> "Sign in with a QR code". The code is
 * photographed to <output directory>/qr-N.png each time Steam replaces it, for somebody to scan,
 * and the run ends when the account is signed in or when STOP exists. The scratch home is thrown
 * away, so the token Steam hands back is not kept.
 *
 *   node scripts/probe-steam-qr.mjs <output directory>
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { launchApp, sleep } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const stopFile = path.join(os.homedir(), '.local/share/moho-dev/stop')
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const ev = (code) => page.evaluate(code)
const shot = async (name) => {
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
}
try {
  try {
    const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j']).toString())
    for (const c of clients.filter((c) => /electron|moho/i.test(c.class + c.title))) execFileSync('hyprctl', ['dispatch', 'movetoworkspacesilent', `2,address:${c.address}`])
  } catch {}
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: false })
  // Everything the daemon says about the sign-in, kept as it comes.
  await ev(`window.__events = []; window.moho.onEvent((e) => { if (String(e.event).startsWith('steamLogin') || e.event === 'accountsChanged') window.__events.push({ at: Date.now(), event: e.event, data: JSON.stringify(e.data).slice(0, 300) }) })`)
  await ev(`window.__mohoShots.store.setActivePanel('accounts')`)
  await sleep(800)
  const click = (text) => ev(`(() => { const e = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().includes(${JSON.stringify(text)})); if (!e) return false; e.click(); return true })()`)
  say('add form', JSON.stringify(await ev(`[...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 30)`)))
  say('clicked Steam', await click('Steam'))
  await sleep(600)
  say('clicked QR', await click('Sign in with a QR code'))
  let last = ''
  let n = 0
  for (let t = 0; t < 600 && !fs.existsSync(stopFile); t += 2) {
    const src = await ev(`document.querySelector('img.qr-image')?.src ?? ''`)
    if (src && src !== last) {
      last = src
      n++
      await sleep(300)
      await shot(`qr-${n}.png`)
      say('QR', n, 'drawn', src.slice(-40))
    }
    const seen = await ev(`window.__events.splice(0)`).catch(() => [])
    for (const e of seen) say('event', e.event, e.data)
    const accounts = await ev(`JSON.stringify(window.__mohoShots.state().accounts.filter((a) => a.service === 'steam').map((a) => [a.id, a.state]))`)
    if (accounts !== '[]') {
      say('signed in', accounts)
      break
    }
    const toasts = await ev(`JSON.stringify(window.__mohoShots.state().toasts.map((x) => x.message || x.text || JSON.stringify(x)))`)
    if (toasts !== '[]' && toasts !== (globalThis.__t ?? '')) { globalThis.__t = toasts; say('toasts', toasts) }
    await sleep(2000)
  }
  await sleep(4000)
  for (const e of (await ev(`window.__events.splice(0)`).catch(() => []))) say('event', e.event, e.data)
  say('accounts after', await ev(`JSON.stringify(window.__mohoShots.state().accounts.filter((a) => a.service === 'steam').map((a) => [a.id, a.state, a.displayName]))`))
  await shot('qr-after.png')
} finally {
  await stop()
}
