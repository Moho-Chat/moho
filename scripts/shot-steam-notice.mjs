#!/usr/bin/env node
/**
 * Photographs a Steam conversation Steam has warned about: the red banner over
 * it and the red line in the log, then the banner dismissed. Made-up state on a
 * fake IRC server, in a scratch home.
 *
 *   node scripts/shot-steam-notice.mjs <output directory>
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
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1000, height: 620, deviceScaleFactor: 1, mobile: false })
  await page.evaluate(`(() => {
    const s = window.__mohoShots
    const st = s.state()
    const irc = st.accounts[0]
    const account = { ...irc, id: 'steam:me', service: 'steam', displayName: 'me', state: 'connected' }
    const channel = st.buffers.find((b) => b.id.endsWith('|#ui'))
    const notice = { kind: 'suspicious', text: 'Steam warns that this person may not be who they appear to be. Be careful with links, offers and requests for anything - and do not give out your account details.' }
    const dm = { ...channel, id: 'steam:me|Gabe', accountId: 'steam:me', name: 'Gabe', kind: 'dm', remoteId: '76561197960265829', unread: 0, highlight: false, mentions: 0, notice }
    const now = Math.floor(Date.now() / 1000)
    const m = (id, from, body, kind = 'chat') => ({ id, bufferId: dm.id, from, body, ts: now - 600 + Number(id.split(':')[1] || 0), isAction: false, isHighlight: false, kind })
    s.patch({
      accounts: [...st.accounts, account], buffers: [...st.buffers, dm], activeBufferId: dm.id, activeGroupId: '~dms',
      messagesByBuffer: { ...st.messagesByBuffer, [dm.id]: [
        m('1:1', 'Gabe', 'hey, long time'),
        m('2:2', 'Steam', notice.text, 'warning'),
        m('3:3', 'Gabe', 'can you check this link for me')
      ] }
    })
  })()`)
  await sleep(1000)
  const shot = async (name) => {
    const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
    console.log('wrote', name)
  }
  await shot('steam-notice-before.png')
  console.log('banner:', await page.evaluate(`!!document.querySelector('.notice-banner')`), '| warning lines:', await page.evaluate(`document.querySelectorAll('.message-row.warning').length`))
  await page.evaluate(`document.querySelector('.notice-banner-dismiss').click()`)
  await sleep(600)
  console.log('banner after dismiss:', await page.evaluate(`!!document.querySelector('.notice-banner')`), '| warning lines:', await page.evaluate(`document.querySelectorAll('.message-row.warning').length`))
  await shot('steam-notice-after.png')
} finally {
  await stop()
  irc.close()
}
