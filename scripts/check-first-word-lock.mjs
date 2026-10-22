#!/usr/bin/env node
/**
 * The message box in a Discord server (or conversation) the account has not spoken in: replaced by the reason, in a
 * scratch moho with injected state (nothing is contacted). The daemon decides the lock; this checks what the window
 * makes of the `readOnly` it is given.
 *
 *   node scripts/check-first-word-lock.mjs [output directory]
 */
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, sleep } from './lib/harness.mjs'

const out = process.argv[2]
if (out) fs.mkdirSync(out, { recursive: true })
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const ev = (code) => page.evaluate(code)
const results = []
const check = (what, ok, detail = '') => {
  results.push(ok)
  console.log(ok ? '  ok  ' : '  FAIL', what, ok ? '' : detail)
}
const REASON = "Send your first message in this server from Discord's own app or website. Discord flags accounts that start talking in a server from another client."
try {
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await ev(`(() => {
    const s = window.__mohoShots.store
    const acct = { id: 'discord:me', service: 'discord', name: 'me', host: '', port: 0, state: 'connected', hasPassword: true, nick: 'me' }
    const mk = (name, readOnly) => ({ id: 'discord:me|' + name, accountId: 'discord:me', kind: 'channel', name, lastActivityTs: 5, category: 'Channels', groupId: 'account:discord:me', ...(readOnly ? { readOnly } : {}) })
    s.set({ accounts: [acct], groups: [{ id: 'account:discord:me', accountId: 'discord:me', service: 'discord', kind: 'account', name: 'me', position: 0 }], buffers: [mk('chasm/#general', ${JSON.stringify(REASON)}), mk('chasm/#open')], messagesByBuffer: { 'discord:me|chasm/#general': [], 'discord:me|chasm/#open': [] }, activeBufferId: 'discord:me|chasm/#general' })
    s.selectGroup('account:discord:me')
  })()`)
  await sleep(1000)
  check('a locked server shows the reason where the box would be', (await ev(`document.querySelector('.composer-readonly')?.innerText ?? ''`)).includes('first message in this server'))
  check('with a line saying moho opens it by itself', (await ev(`document.querySelector('.composer-readonly')?.innerText ?? ''`)).includes('opens this up by itself'))
  check('and no message box to type in', !(await ev(`!!document.querySelector('.composer-input')`)))
  if (out) {
    const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(out, 'first-word-lock.png'), Buffer.from(data, 'base64'))
  }
  await ev(`(() => { const s = window.__mohoShots.state(); window.__mohoShots.patch({ buffers: s.buffers.map((b) => ({ ...b, readOnly: undefined })) }) })()`)
  await sleep(500)
  check('once the lock is lifted the box is back', await ev(`!!document.querySelector('.composer-input')`))
} catch (e) {
  console.log('  FAIL', e.message)
  results.push(false)
} finally {
  await stop()
}
process.exit(results.every(Boolean) ? 0 : 1)
