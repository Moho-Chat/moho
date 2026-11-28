#!/usr/bin/env node
/**
 * Pictures of a Google Chat space's settings in the window, on the live account (the Google Chat account copied from
 * ~/.config/nobilis/accounts.toml into the test app's own home - the person's moho is not touched): the settings
 * dialog of the space named by MOHO_GC_SPACE (default "Test"), and the space with history off, which is turned off for
 * the picture and on again.
 *
 *   cargo build --release (nobilis) && npx electron-vite build && node scripts/check-googlechat-settings-ui.mjs <out>
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { launchApp, sleep } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
const SPACE = process.env.MOHO_GC_SPACE ?? 'Test'
fs.mkdirSync(out, { recursive: true })

// Only the Google Chat account, as the daemon wrote it.
const account = execFileSync(
  'python3',
  [
    '-c',
    `import tomllib,json;d=tomllib.load(open(${JSON.stringify(path.join(os.homedir(), '.config/nobilis/accounts.toml'))},'rb'));print(json.dumps(d['googlechat_account'][0]))`
  ],
  { encoding: 'utf8' }
)
const a = JSON.parse(account)
const q = (v) => JSON.stringify(String(v ?? ''))
const toml = [
  '[[googlechat_account]]',
  ...['user_id', 'email', 'name', 'user_agent'].map((k) => `${k} = ${q(a[k])}`),
  '[googlechat_account.cookies]',
  ...Object.entries(a.cookies).map(([k, v]) => `${q(k)} = ${q(v)}`),
  ''
].join('\n')

const { page, stop } = await launchApp({
  env: { MOHO_UI_SHOTS: '1' },
  seed: (home) => {
    for (const dir of [path.join(home, 'config', 'nobilis'), path.join(home, '.config', 'nobilis')]) {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'accounts.toml'), toml, { mode: 0o600 })
    }
  }
})
setTimeout(() => void stop().then(() => process.exit(1)), 180000).unref()
const ev = (code) => page.evaluate(code)
const rpc = (method, params = {}) => ev(`window.moho.rpc(${JSON.stringify(method)}, ${JSON.stringify(params)})`)
const shot = async (name) => {
  await sleep(1500)
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
  console.log('  shot', name)
}
const until = async (fn, ms = 60000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    try {
      const v = await fn()
      if (v) return v
    } catch {
      /* not yet */
    }
    await sleep(500)
  }
  return null
}
let ok = true
let bufferId = null
try {
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  const buffer = await until(async () => (await rpc('listBuffers')).find((b) => b.accountId.startsWith('googlechat:') && b.name === SPACE))
  if (!buffer) throw new Error(`no space named ${SPACE}`)
  bufferId = buffer.id
  await ev(`window.__mohoShots.store.setActivePanel?.('chat')`)
  await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(bufferId)})`)
  await sleep(2500)
  await ev(`document.querySelector('[title="Space settings"]')?.click()`)
  const loaded = await until(() => ev(`!!document.querySelector('.room-settings textarea')`), 30000)
  console.log(loaded ? '  ok   the settings dialog shows the space' : '  FAIL the settings dialog did not load')
  ok &&= !!loaded
  await shot('googlechat-space-settings.png')
  await ev(`document.querySelector('[title="Space settings"]')?.click()`)
  // History off, for the picture.
  await rpc('googlechat', { action: 'saveSpaceSettings', bufferId, historyOn: false })
  const notice = await until(() => ev(`!!document.querySelector('.notice-banner-info')`), 20000)
  console.log(notice ? '  ok   history off shows over the conversation' : '  FAIL no history-off notice')
  ok &&= !!notice
  await shot('googlechat-history-off.png')
} catch (e) {
  console.log('stopped:', e.stack)
  ok = false
} finally {
  if (bufferId) await rpc('googlechat', { action: 'saveSpaceSettings', bufferId, historyOn: true }).catch(() => console.log('  FAIL could not turn history back on'))
  await stop()
}
console.log(ok ? 'ALL OK' : 'FAILED')
process.exit(ok ? 0 : 1)
