#!/usr/bin/env node
/**
 * Opens the Accounts pane in a scratch moho and starts a Twitch sign-in: checks that one window of twitch.tv's
 * login opens (nothing is typed into it), then closes that window as a person giving up would, and checks the
 * form comes back with nothing saved. No account is signed in.
 *
 *   node scripts/shot-twitch-signin.mjs <output directory>
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { launchApp, sleep } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const { page, stop, port } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const ev = (code) => page.evaluate(code)
const shot = async (name) => {
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
}
const clickText = (selector, text) => ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) return false; b.click(); return true })()`)
try {
  try {
    const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j']).toString())
    for (const c of clients.filter((c) => /electron|moho/i.test(c.class + c.title))) execFileSync('hyprctl', ['dispatch', 'movetoworkspacesilent', `2,address:${c.address}`])
  } catch {}
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false })
  await ev(`window.__mohoShots.store.setActivePanel('accounts')`)
  await sleep(600)
  say('twitch chip', await clickText('.service-chip', 'Twitch'))
  await sleep(500)
  await shot('twitch-signin-form.png')
  say('sign in', await clickText('button', 'Sign in with Twitch'))
  // The sign-in window is another page of the same app, so the debugging port lists it.
  const targets = async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === 'page' && /twitch\.tv/.test(t.url))
  let found = []
  for (let i = 0; i < 40 && found.length === 0; i++) {
    await sleep(500)
    found = await targets()
  }
  say('sign-in window', JSON.stringify(found.map((t) => t.url)))
  say('waiting text', await ev(`document.querySelector('.add-form')?.textContent.slice(0, 120)`))
  await shot('twitch-signin-waiting.png')
  // Giving up, as a person does by closing it.
  for (const t of found) await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`)
  await sleep(2000)
  say('window gone', (await targets()).length === 0)
  say('back to the form', await ev(`!!([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Sign in with Twitch'))`))
  say('accounts saved', await ev(`window.__mohoShots.state().accounts.filter((a) => a.service === 'twitch').length`))
} finally {
  await stop()
}
