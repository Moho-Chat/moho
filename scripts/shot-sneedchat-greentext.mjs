#!/usr/bin/env node
/**
 * Sneedchat lines that start with ">" in a scratch moho: the site's own coloured echo and a plain one must both
 * draw as 4chan's greentext (#789922) and not as a quote block. Messages are injected; nothing is contacted.
 *
 *   node scripts/shot-sneedchat-greentext.mjs <output directory>
 */
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, sleep } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const ev = (code) => page.evaluate(code)
try {
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 2, mobile: false })
  await ev(`(() => {
    const s = window.__mohoShots.store
    const acct = { id: 'sneedchat:me', service: 'sneedchat', name: 'me', host: '', port: 0, state: 'connected', hasPassword: true, nick: 'me' }
    const b = { id: 'sneedchat:me|#room', accountId: 'sneedchat:me', kind: 'channel', name: '#room', lastActivityTs: 5, groupId: 'account:sneedchat:me' }
    const t = Math.floor(Date.now() / 1000) - 300
    const m = (i, from, body) => ({ id: 'm' + i, bufferId: b.id, from, body, ts: t + i * 20, kind: 'chat', isAction: false, isHighlight: false, isOwn: false, edited: false })
    const messages = [
      m(1, 'alice', 'an ordinary line of chat'),
      m(2, 'bob', '[color=#72ff72]>archlinuxwoman'),
      m(3, 'carol', '>be me\\nwalk into a room\\nnobody notices'),
      m(4, 'bob', 'back to normal')
    ]
    s.set({ accounts: [acct], groups: [{ id: 'account:sneedchat:me', accountId: 'sneedchat:me', service: 'sneedchat', kind: 'account', name: 'me', position: 0 }], buffers: [b], messagesByBuffer: { [b.id]: messages }, activeBufferId: b.id })
    s.selectGroup('account:sneedchat:me')
  })()`)
  await sleep(1200)
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, 'sneedchat-greentext.png'), Buffer.from(data, 'base64'))
  console.log('green lines', await ev(`[...document.querySelectorAll('.greentext')].map((e) => e.textContent + ' => ' + getComputedStyle(e).color)`))
  console.log('quote blocks', await ev(`document.querySelectorAll('.quote-block').length`))
} finally {
  await stop()
}
