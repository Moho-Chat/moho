#!/usr/bin/env node
/**
 * The XMPP parts of the window, in a scratch moho against the local test server: the picker offers XMPP with its mark,
 * the form asks for an address and a password and keeps the button off until both are given, an account is added with
 * the test server's own authority pasted into the advanced settings, and signs in; a second one, without it, stops at the
 * certificate and the account's card shows the fingerprint to trust.
 *
 *   ~/.local/share/moho-dev/xmpp-test.sh up && npx electron-vite build
 *   node scripts/check-xmpp-ui.mjs <output directory>
 */
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, sleep } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const people = Object.fromEntries(
  fs
    .readFileSync(process.env.XMPP_TEST_ACCOUNTS ?? '/1tb/xmpp-test/accounts.txt', 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split(' '))
    .map(([jid, password]) => [jid.split('@')[0], { jid, password }])
)
const ca = fs.readFileSync(process.env.XMPP_TEST_CA ?? '/1tb/xmpp-test/pki/ca.pem', 'utf8')
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
const until = async (fn, ms = 20000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    const v = await ev(fn)
    if (v) return v
    await sleep(200)
  }
  return null
}
const fill = (label, value, tag = 'input') => ev(`(() => {
  const field = [...document.querySelectorAll('.add-form label.field')].find((l) => l.textContent.includes(${JSON.stringify(label)}))
  const input = field.querySelector(${JSON.stringify(tag)})
  const set = Object.getOwnPropertyDescriptor(${tag === 'input' ? 'HTMLInputElement' : 'HTMLTextAreaElement'}.prototype, 'value').set
  set.call(input, ${JSON.stringify(value)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
})()`)
const addDisabled = () => ev(`[...document.querySelectorAll('.add-form button.primary')].find((b) => /Add account/.test(b.textContent))?.disabled`)
const openForm = async () => {
  await ev(`window.__mohoShots.store.setActivePanel('accounts')`)
  await sleep(600)
  await ev(`[...document.querySelectorAll('.service-chip')].find((x) => x.textContent.includes('XMPP')).click()`)
  await sleep(400)
}
try {
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false })
  await ev(`window.__mohoShots.store.setActivePanel('accounts')`)
  await sleep(1200)
  const chip = await ev(`(() => { const c = [...document.querySelectorAll('.service-chip')].find((x) => x.textContent.includes('XMPP')); return c ? c.textContent.trim() : null })()`)
  check('the picker offers XMPP', !!chip, chip)
  await openForm()
  const form = await ev(`document.querySelector('.add-form')?.innerText ?? ''`)
  check('the form asks for an address and a password', /Address/.test(form) && /Password/.test(form), form.slice(0, 120))
  check('nothing can be sent while it is empty', (await addDisabled()) === true)
  await fill('Address', 'not an address')
  await fill('Password', 'x')
  await sleep(200)
  check('an address that is not one keeps it off', (await addDisabled()) === true)
  await fill('Address', people.alice.jid)
  await sleep(200)
  check('an address and a password turn it on', (await addDisabled()) === false)
  await ev(`[...document.querySelectorAll('.add-form button')].find((b) => /More settings/.test(b.textContent)).click()`)
  await sleep(300)
  const adv = await ev(`document.querySelector('.add-form').innerText`)
  check('more settings offer the server, the port, the security mode and an authority', /Server/.test(adv) && /Port/.test(adv) && /Direct TLS/.test(adv) && /authority/i.test(adv))
  await fill('Password', people.alice.password)
  await fill('Server', '127.0.0.1')
  await fill('Certificate authority', ca, 'textarea')
  await shot('xmpp-form.png')
  await ev(`[...document.querySelectorAll('.add-form button.primary')].find((b) => /Add account/.test(b.textContent)).click()`)
  const signedIn = await until(`window.__mohoShots.store.state.accounts.some((a) => a.id === 'xmpp:${people.alice.jid}' && a.state === 'connected')`)
  check('the account is added and signs in', !!signedIn)
  await sleep(500)
  await shot('xmpp-account.png')

  // The same server again as another person, without the authority.
  await openForm()
  await fill('Address', people.bob.jid)
  await fill('Password', people.bob.password)
  await ev(`[...document.querySelectorAll('.add-form button')].find((b) => /More settings/.test(b.textContent)).click()`)
  await sleep(300)
  await fill('Server', '127.0.0.1')
  await ev(`[...document.querySelectorAll('.add-form button.primary')].find((b) => /Add account/.test(b.textContent)).click()`)
  const stopped = await until(`window.__mohoShots.store.state.accounts.some((a) => a.id === 'xmpp:${people.bob.jid}' && a.state === 'auth_failed')`)
  check('a server whose certificate nobody vouched for stops the account', !!stopped)
  await ev(`window.__mohoShots.store.setActivePanel('accounts')`)
  await sleep(800)
  // The tools are in the card's expander.
  await ev(`(() => {
    const card = [...document.querySelectorAll('.panel li, .panel > div, .panel div')].filter((d) => d.textContent.includes('bob@localhost') && d.querySelector('button')).pop()
    const toggle = [...card.querySelectorAll('button')].filter((b) => !/Connect|Disconnect/.test(b.textContent)).pop()
    toggle.click()
  })()`)
  await sleep(500)
  const trust = await until(`[...document.querySelectorAll('.account-tools button')].find((b) => /Trust this certificate/.test(b.textContent)) ? document.querySelector('.account-tools').innerText : null`, 8000)
  check('its card shows the fingerprint and offers to trust it', !!trust && /([0-9a-f]{2}:){31}[0-9a-f]{2}/.test(trust), trust?.replace(/\s+/g, ' ').slice(0, 140))
  await shot('xmpp-certificate.png')
  await ev(`[...document.querySelectorAll('.account-tools button')].find((b) => /Trust this certificate/.test(b.textContent)).click()`)
  const trusted = await until(`window.__mohoShots.store.state.accounts.some((a) => a.id === 'xmpp:${people.bob.jid}' && a.state === 'connected')`)
  check('trusting it signs the account in', !!trusted)
} catch (err) {
  console.log('  FAIL', err.message)
  results.push(false)
} finally {
  await stop()
  console.log(results.every(Boolean) ? 'ALL OK' : 'SOME FAILED')
  process.exitCode = results.every(Boolean) ? 0 : 1
}
