import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { launchApp, sleep } from './lib/harness.mjs'
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const ev = (c) => page.evaluate(c)
try {
  try { const cl = JSON.parse(execFileSync('hyprctl', ['clients', '-j']).toString()); for (const c of cl.filter((c) => /electron|moho/i.test(c.class + c.title))) execFileSync('hyprctl', ['dispatch', 'movetoworkspacesilent', `2,address:${c.address}`]) } catch {}
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  const rpc = (m, p) => ev(`window.moho.rpc(${JSON.stringify(m)}, ${JSON.stringify(p)}).catch((e) => ({ error: String(e.message || e) }))`)
  const a = await rpc('addKickAccount', {})
  await rpc('joinBuffer', { accountId: a.accountId, name: 'spreen' })
  const id = `${a.accountId}|spreen`
  await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(id)})`)
  await sleep(20000)
  console.log(await ev(`JSON.stringify({ images: document.querySelectorAll('.sender-badge-image').length, loaded: [...document.querySelectorAll('.sender-badge-image')].filter((i) => i.complete && i.naturalWidth > 0).length, words: [...document.querySelectorAll('.sender-badge')].map((b) => b.textContent).slice(0, 8), titles: [...new Set([...document.querySelectorAll('.sender-badge-image')].map((i) => i.title))].slice(0, 8) })`))
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(process.env.HOME + '/.local/share/moho-dev/shots/kick-badges.png', Buffer.from(data, 'base64'))
} finally { await stop() }
