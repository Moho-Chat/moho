#!/usr/bin/env node
/**
 * Opens the Accounts pane in a scratch moho, starts a Twitch sign-in and photographs the code it shows,
 * then cancels it. Nothing is approved, so no account is signed in and nothing is saved.
 *
 *   node scripts/shot-twitch-signin.mjs <output directory>
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { launchApp, sleep } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
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
  for (let i = 0; i < 20 && !(await ev(`!!document.querySelector('.twitch-code')`)); i++) await sleep(500)
  say('code shown', await ev(`JSON.stringify({ code: document.querySelector('.twitch-code')?.textContent, buttons: [...document.querySelectorAll('.add-form button')].map((b) => b.textContent.trim()) })`))
  await shot('twitch-signin-code.png')
  say('cancel', await clickText('button', 'Cancel sign-in'))
  await sleep(500)
  say('back to the form', await ev(`!document.querySelector('.twitch-code') && !!([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Sign in with Twitch'))`))
  say('accounts saved', await ev(`window.__mohoShots.state().accounts.filter((a) => a.service === 'twitch').length`))
} finally {
  await stop()
}
