#!/usr/bin/env node
/**
 * Photographs the column about a Steam friend, beside their conversation, and
 * checks the conversation's right-click menu offers it. Made-up state on a fake
 * IRC server, in a scratch home.
 *
 *   node scripts/shot-steam-profile.mjs <output directory>
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
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false })
  await page.evaluate(`(() => {
    const s = window.__mohoShots
    const st = s.state()
    const irc = st.accounts[0]
    const account = { ...irc, id: 'steam:me', service: 'steam', displayName: 'me', state: 'connected' }
    const channel = st.buffers.find((b) => b.id.endsWith('|#ui'))
    const dm = { ...channel, id: 'steam:me|Gabe', accountId: 'steam:me', name: 'Gabe', kind: 'dm', remoteId: '76561197960265829', unread: 0, highlight: false, mentions: 0 }
    const now = Math.floor(Date.now() / 1000)
    const m = (id, body) => ({ id, bufferId: dm.id, from: 'Gabe', body, ts: now - 600 + Number(id.split(':')[1]), isAction: false, isHighlight: false, kind: 'chat' })
    s.patch({
      accounts: [...st.accounts, account], buffers: [...st.buffers, dm], activeBufferId: dm.id, activeGroupId: '~dms',
      messagesByBuffer: { ...st.messagesByBuffer, [dm.id]: [m('1:1', 'want to play later?')] },
      presenceByBuffer: { ...st.presenceByBuffer, [dm.id]: [{ nick: 'Gabe', status: 'online', userId: '76561197960265829', activity: { kind: 'game', text: 'Counter-Strike 2' }, client: 'desktop', rich: 'Competitive - Dust II' }] }
    })
  })()`)
  await sleep(600)
  // The right-click menu of the row, and what it offers.
  const rect = await page.evaluate(`(() => { const r = [...document.querySelectorAll('.buffer-row, .buffer')].find((e) => e.textContent.includes('Gabe')); if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.x + 20, y: b.y + 10 } })()`)
  console.log('row at', JSON.stringify(rect))
  await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'right', clickCount: 1 })
  await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'right', clickCount: 1 })
  await sleep(400)
  console.log('menu:', JSON.stringify(await page.evaluate(`[...document.querySelectorAll('[role=menuitem], .context-menu button')].map((e) => e.textContent.trim()).slice(0, 6)`)))
  // Chosen from the menu, as a person would.
  console.log('clicked Profile:', await page.evaluate(`(() => { const e = [...document.querySelectorAll('[role=menuitem], .context-menu button')].find((x) => x.textContent.trim() === 'Profile'); if (!e) return false; e.click(); return true })()`))
  await sleep(500)
  // What Steam said, as the daemon would send it: the card every service opens.
  await page.evaluate(`window.__mohoShots.patch({ profile: {
    service: 'steam', accountId: 'steam:me', id: '76561197960265729', name: 'Gabe', createdTs: 1300000000,
    status: 'online', activity: { kind: 'game', text: 'Counter-Strike 2' },
    nameHistory: [{ name: 'Gabe Newell', when: '3 Mar, 2019 @ 1:00am' }, { name: 'Valve Gabe', when: '12 Jun, 2012 @ 6:40pm' }],
    extra: [{ label: 'Steam level', value: '42' }, { label: 'Real name', value: 'Gabe N' }, { label: 'Location', value: 'Bellevue, United States' }, { label: 'On', value: 'desktop' }, { label: 'Doing', value: 'Competitive - Dust II' }, { label: 'Headline', value: 'Hello' }]
  } })`)
  await sleep(500)
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, 'steam-profile-card.png'), Buffer.from(data, 'base64'))
  console.log('wrote steam-profile-card.png; card:', await page.evaluate(`!!document.querySelector('.profile-card')`), '| previous names:', await page.evaluate(`document.querySelectorAll('.profile-name-history li').length`))
  // Offline: last seen instead of playing.
  await page.evaluate(`(() => { const s = window.__mohoShots; const st = s.state(); s.patch({ profile: { ...st.profile, status: 'offline', activity: null, lastActiveTs: Math.floor(Date.now() / 1000) - 7200 } }) })()`)
  await sleep(400)
  console.log('offline card:', JSON.stringify(await page.evaluate(`document.querySelector('.profile-card')?.innerText.replace(/\\n+/g, ' | ').slice(0, 300)`)))
} finally {
  await stop()
  irc.close()
}
