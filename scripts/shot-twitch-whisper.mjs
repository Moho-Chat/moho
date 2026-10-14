#!/usr/bin/env node
/**
 * A Twitch channel and a whisper conversation side by side in the channel list, to see that they can be told
 * apart. Injects the two buffers; nothing is contacted.
 *
 *   node scripts/shot-twitch-whisper.mjs <output directory>
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
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 2, mobile: false })
  await ev(`(() => {
    const s = window.__mohoShots.store
    const acct = { id: 'twitch:me', service: 'twitch', name: 'me', host: '', port: 0, state: 'connected', hasPassword: true, nick: 'me' }
    const pic = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#7b5cd6"/><circle cx="32" cy="26" r="12" fill="#fff"/><rect x="14" y="42" width="36" height="16" rx="8" fill="#fff"/></svg>')
    const buffers = [
      { id: 'twitch:me|skitzy_va', accountId: 'twitch:me', kind: 'channel', name: 'skitzy_va', lastActivityTs: 5, avatarUrl: pic, category: 'Channels', groupId: 'account:twitch:me' },
      { id: 'twitch:me|kotbarsik_twt', accountId: 'twitch:me', kind: 'channel', name: 'kotbarsik_twt', lastActivityTs: 4, avatarUrl: pic, category: 'Channels', groupId: 'account:twitch:me' },
      { id: 'twitch:me|@anon7of10', accountId: 'twitch:me', kind: 'dm', name: '@anon7of10', lastActivityTs: 6, avatarUrl: pic, category: 'Direct Messages', groupId: 'account:twitch:me' }
    ]
    s.set({ accounts: [acct], groups: [{ id: 'account:twitch:me', accountId: 'twitch:me', service: 'twitch', kind: 'account', name: 'me', position: 0 }], buffers, activeBufferId: 'twitch:me|skitzy_va' })
    s.selectGroup('account:twitch:me')
  })()`)
  await sleep(800)
    await sleep(400)
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, 'twitch-whisper-vs-channel.png'), Buffer.from(data, 'base64'))
  console.log('rows', await ev(`[...document.querySelectorAll('.buffer-row')].map((r) => r.innerText.replace(/\\n/g, ' ') + (r.querySelector('.avatar-badge') ? ' [badge]' : ''))`))
} finally {
  await stop()
}
