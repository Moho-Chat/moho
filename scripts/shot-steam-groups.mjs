#!/usr/bin/env node
/**
 * Photographs the direct-messages page when a Steam account has friend groups:
 * each group a heading, its friends' conversations under it. Then changes one
 * as Steam would, and reads where the conversation went. Made-up state on a fake
 * IRC server, in a scratch home.
 *
 *   node scripts/shot-steam-groups.mjs <output directory>
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
  await page.evaluate(`(() => {
    const s = window.__mohoShots
    const st = s.state()
    const irc = st.accounts[0]
    const account = { ...irc, id: 'steam:me', service: 'steam', displayName: 'me', state: 'connected' }
    const channel = st.buffers.find((b) => b.id.endsWith('|#ui'))
    const dm = (name, remoteId) => ({ ...channel, id: 'steam:me|' + name, accountId: 'steam:me', name, kind: 'dm', remoteId, unread: 0, highlight: false, mentions: 0 })
    s.patch({
      accounts: [...st.accounts, account],
      buffers: [...st.buffers, dm('Gabe', '76561197960265729'), dm('Alyx', '76561197960287930'), dm('Eli', '76561197960265730')],
      activeBufferId: 'steam:me|Gabe', activeGroupId: '~dms',
      steamGroups: { 'steam:me': [{ id: 7, name: 'Raiders', members: ['76561197960265729', '76561197960265730'] }, { id: 8, name: 'Work', members: [] }] }
    })
  })()`)
  await sleep(1500)
  const headings = () => page.evaluate(`[...document.querySelectorAll('.sidebar')].map((s) => s.innerText).join('|')`)
  console.log('page:', JSON.stringify(await headings()))
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, 'steam-groups.png'), Buffer.from(data, 'base64'))
  // Steam moves Alyx into Work.
  await page.evaluate(`(() => { const s = window.__mohoShots; s.patch({ steamGroups: { 'steam:me': [{ id: 7, name: 'Raiders', members: ['76561197960265729', '76561197960265730'] }, { id: 8, name: 'Work', members: ['76561197960287930'] }] } }) })()`)
  await sleep(1200)
  console.log('after Steam moved Alyx into Work:', JSON.stringify(await headings()))
} finally {
  await stop()
  irc.close()
}
