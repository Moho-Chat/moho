#!/usr/bin/env node
/**
 * Google Chat's way in, in the window: the service among the others on the add page, its form, and the sign-in window
 * it opens - which has to reach Google's own sign-in page (chat.google.com sends a signed-out visitor there) and present
 * itself without Electron's words in its user agent, or Google refuses the sign-in. Nothing is typed into Google's
 * page; the window is closed again, which the form takes as a decision rather than an error.
 *
 *   npx electron-vite build && node scripts/check-googlechat-signin.mjs <output directory>
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { launchApp, sleep, cdp } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const results = []
const check = (what, ok, detail = '') => {
  results.push(ok)
  console.log(ok ? '  ok  ' : '  FAIL', what, ok ? '' : detail)
}
const until = async (fn, ms = 30000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    try {
      const v = await fn()
      if (v) return v
    } catch {
      /* not yet */
    }
    await sleep(300)
  }
  return null
}

const { page, stop, port } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
setTimeout(() => void stop().then(() => process.exit(1)), 150000).unref()
const ev = (code) => page.evaluate(code)
const shot = async (target, name) => {
  await sleep(1500)
  const { data } = await target.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
  console.log('  shot', name)
}
try {
  await sleep(2000)
  const protocols = await ev(`window.moho.rpc('listProtocols')`)
  check('the daemon offers Google Chat', protocols.some((p) => p.id === 'googlechat'))
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await ev(`window.__mohoShots.store.setActivePanel('accounts')`)
  await sleep(500)
  await ev(`document.querySelector('[data-add-account]')?.click()`)
  await sleep(800)
  check('Google Chat is among the services', await ev(`[...document.querySelectorAll('.service-tile')].some((x) => x.textContent.includes('Google Chat'))`))
  await shot(page, 'googlechat-services.png')
  await ev(`[...document.querySelectorAll('.service-tile')].find((x) => x.textContent.includes('Google Chat')).click()`)
  await sleep(500)
  check('its form offers to sign in with Google', await ev(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Sign in with Google'))`))
  await shot(page, 'googlechat-form.png')

  await ev(`(window.__signin = window.moho.browserLogin('googlechat', undefined, { useTor: false }).then((r) => { window.__outcome = JSON.stringify(r) }), true)`)
  const target = await until(async () => {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    return list.find((t) => t.type === 'page' && /accounts\.google\.com/.test(t.url))
  }, 45000)
  check('the window reaches Google’s own sign-in page', !!target)
  try {
    const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j'], { encoding: 'utf8' }))
    for (const c of clients.filter((c) => /Sign in to Google/.test(c.title))) {
      execFileSync('hyprctl', ['dispatch', `hl.dsp.window.move({ window = "address:${c.address}", workspace = "2", silent = true })`])
    }
  } catch {
    /* not on Hyprland */
  }
  if (target) {
    const login = cdp(target.webSocketDebuggerUrl)
    // Attached early, the page can still be the window's first blank one: Google's is waited for.
    await until(() => login.evaluate(`location.hostname === 'accounts.google.com' && document.readyState === 'complete'`), 30000)
    const ua = await login.evaluate('navigator.userAgent')
    check('it presents itself as plain Chromium', /Chrome\//.test(ua) && !/Electron|moho/i.test(ua), ua)
    const ready = await until(() => login.evaluate(`!!document.querySelector('#identifierId, input[name=identifier], input[type=email]')`), 20000)
    check('Google asks for an email address (not "this browser may not be secure")', !!ready)
    await shot(login, 'googlechat-google-signin.png')
    login.close()
    await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`)
  }
  const outcome = await until(() => ev('window.__outcome'), 15000)
  check('closing the window is a cancel, not an error', !!outcome && JSON.parse(outcome).error === 'cancelled', outcome)
  const accounts = await ev(`window.moho.rpc('listAccounts')`)
  check('no account was made', !accounts.some((a) => a.service === 'googlechat'))
} catch (e) {
  console.log('probe stopped:', e.stack)
  results.push(false)
} finally {
  await stop()
}
const failed = results.filter((r) => !r).length
console.log(failed ? `${failed} FAILED` : 'ALL OK')
process.exit(failed ? 1 : 0)
