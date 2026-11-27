#!/usr/bin/env node
/**
 * Google Chat's way in: the service among the others on the add page, its form, and the sign-in it starts - Firefox,
 * with a profile of its own, on Google's Chat sign-in (Google refuses every Electron window). Nothing is typed into
 * Google's page: Firefox is closed again, which is a cancel, makes no account, and leaves no profile behind.
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
  // Firefox, with a profile of its own, on Google's sign-in: found by its command line.
  const firefox = await until(() => {
    const out = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' })
    const line = out.split('\n').find((l) => /firefox/.test(l) && /moho-google-[^/ ]+\/profile/.test(l))
    return line ? { pid: Number(line.trim().split(/\s+/)[0]), profile: /(\S*moho-google-[^/ ]+\/profile)/.exec(line)[1] } : null
  }, 20000)
  check('Firefox opens with a profile of its own', !!firefox)
  try {
    const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j'], { encoding: 'utf8' }))
    for (const c of clients.filter((c) => /firefox/i.test(c.class) && c.pid === firefox?.pid)) {
      execFileSync('hyprctl', ['dispatch', `hl.dsp.window.move({ window = "address:${c.address}", workspace = "2", silent = true })`])
    }
  } catch {
    /* not on Hyprland */
  }
  if (firefox) {
    // Google's sign-in page sets its first cookies as it loads, which says the page is there.
    const loaded = await until(() => {
      const db = path.join(firefox.profile, 'cookies.sqlite')
      if (!fs.existsSync(db)) return false
      const copy = path.join(out, 'probe-cookies.sqlite')
      fs.copyFileSync(db, copy)
      if (fs.existsSync(db + '-wal')) fs.copyFileSync(db + '-wal', copy + '-wal')
      const hosts = execFileSync('sqlite3', [copy, "select distinct host from moz_cookies where host like '%google.com'"], { encoding: 'utf8' })
      for (const f of [copy, copy + '-wal', copy + '-shm']) fs.rmSync(f, { force: true })
      return hosts.includes('accounts.google.com')
    }, 40000)
    check('Google’s sign-in page loads in it', !!loaded)
    // Closing Firefox: the way a person gives up.
    try {
      process.kill(firefox.pid, 'SIGTERM')
    } catch {
      /* gone */
    }
  }
  const outcome = await until(() => ev('window.__outcome'), 15000)
  check('closing the window is a cancel, not an error', !!outcome && JSON.parse(outcome).error === 'cancelled', outcome)
  const accounts = await ev(`window.moho.rpc('listAccounts')`)
  check('no account was made', !accounts.some((a) => a.service === 'googlechat'))
  await sleep(4000)
  check('the profile is deleted afterwards', !!firefox && !fs.existsSync(firefox.profile))
} catch (e) {
  console.log('probe stopped:', e.stack)
  results.push(false)
} finally {
  await stop()
}
const failed = results.filter((r) => !r).length
console.log(failed ? `${failed} FAILED` : 'ALL OK')
process.exit(failed ? 1 : 0)
