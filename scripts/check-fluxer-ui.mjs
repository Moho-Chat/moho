#!/usr/bin/env node
/**
 * Pictures of Fluxer in the window, against the local self-hosted Fluxer (mohoa signed in): the sign-in form with the
 * code to approve in another app, a guild channel with its categories and members, the forum pane, and a call.
 *
 *   npx electron-vite build && node scripts/check-fluxer-ui.mjs <output directory>
 */
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, sleep } from './lib/harness.mjs'
import { accounts, as, ORIGIN } from './lib/fluxer-local.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const acc = accounts()
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' }, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
const ev = (code) => page.evaluate(code)
const rpc = (method, params = {}) => ev(`window.moho.rpc(${JSON.stringify(method)}, ${JSON.stringify(params)})`)
const shot = async (name) => {
  await sleep(1200)
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
  console.log('  shot', name)
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
let ok = true
try {
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  // The form, and the code it shows for another app to approve.
  await ev(`window.__mohoShots.store.setActivePanel('accounts')`)
  await sleep(500)
  await ev(`document.querySelector('[data-add-account]')?.click()`)
  await sleep(500)
  await ev(`[...document.querySelectorAll('.service-tile')].find((x) => x.textContent.includes('Fluxer')).click()`)
  await shot('fluxer-form.png')
  await ev(`(() => { const i = [...document.querySelectorAll('.add-form input')][0]; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(ORIGIN)}); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await ev(`[...document.querySelectorAll('.add-form button.primary')].find((b) => /Get a code/.test(b.textContent)).click()`)
  await until(() => ev(`!!document.querySelector('.fluxer-handoff-code')`))
  await shot('fluxer-form-code.png')
  await ev(`[...document.querySelectorAll('.add-form button')].find((b) => /Cancel/.test(b.textContent))?.click()`)

  // Signed in, a guild channel.
  await rpc('addFluxerAccountToken', { instance: ORIGIN, token: acc.mohoa.token })
  const account = `fluxer:${acc.mohoa.user_id}`
  ok = !!(await until(async () => (await rpc('listAccounts')).find((a) => a.id === account && a.state === 'connected'))) && ok
  await ev(`window.__mohoShots.store.setActivePanel?.('chat')`)
  await ev(`window.__mohoShots?.store.refreshAccounts?.(); window.__mohoShots?.store.refreshBuffers?.()`)
  const hall = (await as('mohob', 'GET', '/users/@me/guilds')).find((g) => g.name === 'Test Hall')
  const channels = await as('mohob', 'GET', `/guilds/${hall.id}/channels`)
  const general = await until(async () => (await rpc('listBuffers')).find((b) => b.accountId === account && b.remoteId === channels.find((c) => c.name === 'general').id))
  await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(general.id)})`)
  await rpc('requestMemberList', { bufferId: general.id })
  await shot('fluxer-channel.png')

  // The forum pane.
  const forum = channels.find((c) => c.type === 15)
  const forumBuffer = forum && (await until(async () => (await rpc('listBuffers')).find((b) => b.accountId === account && b.remoteId === forum.id)))
  if (forumBuffer) {
    await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(forumBuffer.id)})`)
    await sleep(1500)
    await shot('fluxer-forum.png')
  }

  // A voice channel's call.
  const voice = await until(async () => (await rpc('listBuffers')).find((b) => b.accountId === account && b.remoteId === channels.find((c) => c.type === 2).id))
  await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(voice.id)})`)
  await ev(`window.__mohoShots.store.joinStoatCall(${JSON.stringify(voice.id)}, true)`)
  await until(() => ev('window.__mohoShots.state().activeCall?.phase === "connected"'))
  await shot('fluxer-call.png')
  await ev('window.__mohoShots.store.hangUpMatrixCall()')
  await sleep(1000)
} catch (e) {
  console.log('stopped:', e.stack)
  ok = false
} finally {
  await stop()
}
console.log(ok ? 'DONE' : 'FAILED')
process.exit(ok ? 0 : 1)
