#!/usr/bin/env node
/**
 * Photographs the message box of a Steam conversation with its emoji picker
 * open: no GIF button, and a picker with no Unicode emoji. Made-up state, on a
 * fake IRC server, in a scratch home.
 *
 *   node scripts/shot-steam-picker.mjs <output directory>
 */
import fs from 'node:fs'
import path from 'node:path'
import { fakeIrc, launchApp, openIrcChannel, sleep } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const irc = await fakeIrc({ people: ['alice'], onJoin: (c, _n, send) => send(`:alice!u@h PRIVMSG ${c} :hello there`) })
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
try {
  await openIrcChannel(page, { port: irc.address().port, nick: 'checker', channels: ['#ui'], waitFor: 'hello there' })
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false })
  const shot = async (name) => {
    await sleep(600)
    const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
    console.log('wrote', name)
  }
  // A Steam account and a conversation with a friend, selected.
  await page.evaluate(`(() => {
    const s = window.__mohoShots
    const st = s.state()
    const irc = st.accounts[0]
    const account = { ...irc, id: 'steam:me', service: 'steam', displayName: 'me', state: 'connected' }
    const channel = st.buffers.find((b) => b.id.endsWith('|#ui'))
    const dm = { ...channel, id: 'steam:me|Gabe', accountId: 'steam:me', name: 'Gabe', kind: 'dm', remoteId: '76561197960265829', unread: 0, highlight: false, mentions: 0 }
    s.patch({ accounts: [...st.accounts, account], buffers: [...st.buffers, dm], activeBufferId: dm.id, activeGroupId: '~dms' })
  })()`)
  await shot('steam-composer.png')
  await page.evaluate(`document.querySelector('button[title="Emoji"]').click()`)
  await shot('steam-picker.png')
  const gif = await page.evaluate(`!!document.querySelector('button[title="GIFs"]')`)
  const sticker = await page.evaluate(`!!document.querySelector('button[title="Stickers"]')`)
  console.log('GIF button:', gif, '| Stickers button:', sticker)
} finally {
  await stop()
  irc.close()
}
