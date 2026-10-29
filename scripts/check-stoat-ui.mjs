#!/usr/bin/env node
/**
 * The Stoat parts of the window, in a scratch moho (nothing is typed into a form that would be sent): the account
 * picker offers Stoat with its mark, the form asks for an instance (optional), an email and a password, keeps the
 * button off until the last two are given, and offers a pasted session token as the other way in.
 *
 *   node scripts/check-stoat-ui.mjs <output directory>
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
  const chip = await ev(`(() => { const c = [...document.querySelectorAll('.service-chip')].find((x) => x.textContent.includes('Stoat')); return c ? { text: c.textContent.trim(), mark: !!c.querySelector('.mask-icon, img, span[style*="mask"]') } : null })()`)
  check('the picker offers Stoat', !!chip, JSON.stringify(chip))
  await ev(`[...document.querySelectorAll('.service-chip')].find((x) => x.textContent.includes('Stoat')).click()`)
  await sleep(500)
  const form = await ev(`(() => { const f = document.querySelector('.add-form'); return f ? f.innerText : '' })()`)
  check('the form says the instance can be left empty and where accounts are made', /official one/.test(form) && /own app/.test(form), form.slice(0, 160))
  check('it asks for an email and a password', /Email/.test(form) && /Password/.test(form))
  const signIn = () => ev(`[...document.querySelectorAll('.add-form button.primary')].find((b) => /Sign in/.test(b.textContent))?.disabled`)
  check('nothing can be sent while the form is empty', (await signIn()) === true)
  const fill = (label, value) => ev(`(() => {
    const field = [...document.querySelectorAll('.add-form label.field')].find((l) => l.textContent.includes(${JSON.stringify(label)}))
    const input = field.querySelector('input')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await fill('Email', 'me@example.org')
  check('an email alone is not enough', (await signIn()) === true)
  await fill('Password', 'hunter2')
  await sleep(200)
  check('an email and a password turn the button on', (await signIn()) === false)
  await shot('stoat-form.png')
  await ev(`[...document.querySelectorAll('.add-form .segmented button')].find((b) => /token/i.test(b.textContent)).click()`)
  await sleep(300)
  check('a session token can be pasted instead', /Session token/.test(await ev(`document.querySelector('.add-form').innerText`)))
  check('which needs only the token', (await signIn()) === true)
  await fill('Session token', 'abc')
  await sleep(200)
  check('and then it can be sent', (await signIn()) === false)
} finally {
  await stop()
  console.log(results.every(Boolean) ? 'ALL OK' : 'SOME FAILED')
  process.exitCode = results.every(Boolean) ? 0 : 1
}
