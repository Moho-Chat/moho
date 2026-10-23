#!/usr/bin/env node
/**
 * The Telegram parts of the window, in a scratch moho (nothing is typed into a form that would be sent, so nothing
 * reaches Telegram): the account picker offers Telegram with its mark, its form asks for the api_id, the api_hash and
 * the phone number, explains where the first two come from, keeps the button off until all three are given, and
 * warns about Tor.
 *
 *   node scripts/check-telegram-ui.mjs <output directory>
 */
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, sleep } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const ev = (code) => page.evaluate(code)
const shot = async (name) => {
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
}
const results = []
const check = (what, ok, detail = '') => {
  results.push(ok)
  console.log(ok ? '  ok  ' : '  FAIL', what, detail)
}
try {
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false })
  await ev(`window.__mohoShots.store.setActivePanel('accounts')`)
  await sleep(1200)
  const chip = await ev(`(() => { const c = [...document.querySelectorAll('.service-chip')].find((x) => x.textContent.includes('Telegram')); return c ? { text: c.textContent.trim(), mark: !!c.querySelector('.mask-icon, img, span[style*="mask"]') } : null })()`)
  check('the picker offers Telegram', !!chip, JSON.stringify(chip))
  await ev(`[...document.querySelectorAll('.service-chip')].find((x) => x.textContent.includes('Telegram')).click()`)
  await sleep(500)
  const form = await ev(`(() => { const f = document.querySelector('.add-form'); return f ? f.innerText : '' })()`)
  check('the form says where the api_id comes from', /my\.telegram\.org\/apps/.test(form), form.slice(0, 120))
  check('it asks for the api_id, the api_hash and the phone number', /api_id/.test(form) && /api_hash/.test(form) && /Phone number/.test(form))
  const qrDisabled = () => ev(`[...document.querySelectorAll('.add-form button')].find((b) => /QR code/.test(b.textContent))?.disabled`)
  check('a QR code is offered as the other way in', (await qrDisabled()) !== undefined)
  check('and waits for the api_id and the api_hash, which it needs, but not for a phone number', (await qrDisabled()) === true)
  const disabled = () => ev(`[...document.querySelectorAll('.add-form button.primary')].find((b) => /Send the code/.test(b.textContent))?.disabled`)
  check('nothing can be sent while the form is empty', (await disabled()) === true)
  const fill = (placeholderOrLabel, value) => ev(`(() => {
    const label = [...document.querySelectorAll('.add-form label.field')].find((l) => l.textContent.includes(${JSON.stringify(placeholderOrLabel)}))
    const input = label.querySelector('input')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await fill('api_id', '12345')
  await fill('api_hash', 'abcdef')
  check('two of three are not enough', (await disabled()) === true)
  check('the QR code needs only those two', (await qrDisabled()) === false)
  await fill('Phone number', '+1 555 123 4567')
  await sleep(200)
  check('all three turn the button on', (await disabled()) === false)
  await ev(`document.querySelector('.add-form .switch')?.click()`)
  await sleep(300)
  const warning = await ev(`document.querySelector('.add-form .warning-note')?.innerText || ''`)
  check('routing it says Telegram may challenge a Tor sign-in', /Telegram/.test(warning), warning.slice(0, 80))
  await shot('telegram-form.png')
} finally {
  await stop()
  console.log(results.every(Boolean) ? 'ALL OK' : 'SOME FAILED')
  process.exitCode = results.every(Boolean) ? 0 : 1
}
