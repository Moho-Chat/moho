#!/usr/bin/env node
/**
 * Google Chat's way in: the service among the others on the add page, its form, and the sign-in it starts - the
 * default browser, with a profile of its own, on Google's Chat sign-in (Google refuses every Electron window). Nothing
 * is typed into Google's page: the browser is closed again, which is a cancel, makes no account, and leaves no profile
 * behind.
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
    // The browser's own process, not one of a Chromium's helpers (--type=...). Whichever browser moho chose: the
    // harness's scratch home has no default of its own, so the system's is used.
    const line = out.split('\n').find((l) => /moho-google-[^/ ]+\/profile/.test(l) && !/--type=|--headless/.test(l))
    return line ? { pid: Number(line.trim().split(/\s+/)[0]), profile: /(\/\S*moho-google-[^/ ]+\/profile)/.exec(line)[1], args: line } : null
  }, 20000)
  check('the browser opens with a profile of its own', !!firefox, '')
  if (firefox) console.log('   browser:', firefox.args.split(' ')[1].split('/').pop())
  try {
    const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j'], { encoding: 'utf8' }))
    for (const c of clients.filter((c) => c.pid === firefox?.pid)) {
      execFileSync('hyprctl', ['dispatch', `hl.dsp.window.move({ window = "address:${c.address}", workspace = "2", silent = true })`])
    }
  } catch {
    /* not on Hyprland */
  }
  if (firefox) {
    // The window's title says Google's sign-in page is there ("Sign in - Google Accounts - <browser>").
    const loaded = await until(() => {
      const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j'], { encoding: 'utf8' }))
      return clients.some((c) => c.pid === firefox.pid && /Google Accounts|Sign in/i.test(c.title))
    }, 45000)
    check('Google’s sign-in page loads in it', !!loaded)
    // Closing Firefox: the way a person gives up.
    try {
      process.kill(firefox.pid, 'SIGTERM')
    } catch {
      /* gone */
    }
  }
  const outcome = await until(() => ev('window.__outcome'), 30000)
  check('closing the window is a cancel, not an error', !!outcome && JSON.parse(outcome).error === 'cancelled', outcome)
  const accounts = await ev(`window.moho.rpc('listAccounts')`)
  check('no account was made', !accounts.some((a) => a.service === 'googlechat'))
  await sleep(6000)
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
