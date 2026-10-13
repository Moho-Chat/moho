#!/usr/bin/env node
/**
 * Photographs a Steam account's own page with its friends under the account's folders, then moves a
 * friend to another folder by dragging and says which changes the window asked Steam for. Made-up
 * state on a fake IRC server, in a scratch home; the daemon's answers are stood in for here.
 *
 *   node scripts/shot-steam-folders.mjs <output directory>
 */
import fs from 'node:fs'
import path from 'node:path'
import { fakeIrc, launchApp, openIrcChannel, sleep } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const irc = await fakeIrc({ people: ['alice'], onJoin: (c, _n, send) => send(`:alice!u@h PRIVMSG ${c} :hello there`) })
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const shot = async (name) => {
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
}
try {
  await openIrcChannel(page, { port: irc.address().port, nick: 'checker', channels: ['#ui'], waitFor: 'hello there' })
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await page.evaluate(`(() => {
    window.__calls = []
    const folders = [
      { id: 1, name: 'Steam - ISRAD', members: ['76561197960265704'] },
      { id: 3, name: 'Steam - Friends', members: ['76561197960265701', '76561197960265702'] },
      { id: 5, name: 'Steam - PL', members: ['76561197960265705'] },
      { id: 7, name: 'Steam - Goons', members: ['76561197960265703'] }
    ]
    window.__folders = folders
    window.__rpcFixture = { steamFriendGroups: () => folders, steamGroupChange: (p) => { window.__calls.push(p); return {} } }
    const s = window.__mohoShots
    const st = s.state()
    const irc = st.accounts[0]
    const ircGroup = st.groups.find((g) => g.kind === 'account')
    const channel = st.buffers.find((b) => b.id.endsWith('|#ui'))
    const account = { ...irc, id: 'steam:me', service: 'steam', displayName: 'me', state: 'connected' }
    const group = { ...ircGroup, id: 'account:steam:me', accountId: 'steam:me', service: 'steam', name: 'Steam - me' }
    const friend = (name, id, category) => ({ ...channel, id: 'steam:me|' + name, accountId: 'steam:me', name, kind: 'dm', remoteId: id, groupId: group.id, category: category ?? null, position: 0, unread: 0, highlight: false, mentions: 0 })
    const buffers = [
      friend('Dandalf', '76561197960265701', 'Friends'), friend('GetCreped', '76561197960265702', 'Friends'),
      friend('Shaod', '76561197960265703', 'Goons'), friend('WigglyQuimble', '76561197960265704', 'ISRAD'),
      friend('Hujoppi', '76561197960265705', 'PL'), friend('Stranger', '76561197960265706', null)
    ]
    s.patch({
      accounts: [...st.accounts, account],
      groups: [...st.groups, group],
      buffers: [...st.buffers, ...buffers],
      steamGroups: { 'steam:me': folders },
      activeGroupId: group.id, activeBufferId: buffers[0].id
    })
  })()`)
  await sleep(1500)
  // The daemon answered the window's own question about the made-up account with nothing; say it again.
  await page.evaluate(`window.__mohoShots.patch({ steamGroups: { 'steam:me': window.__folders } })`)
  await sleep(500)
  await shot('steam-folders.png')
  console.log('classes:', JSON.stringify(await page.evaluate(`[...document.querySelectorAll('.bufferlist [class*=category]')].filter((e) => e.textContent.trim() === 'expand_morePL').map((e) => e.className + ' ' + e.tagName + ' ' + e.draggable)`)))
  await page.evaluate(`(() => { const st = window.__mohoShots.store; window.__ranAll = []; const orig = st.moveSteamFriend.bind(st); st.moveSteamFriend = (...a) => { window.__moved = a; return orig(...a) }; const run = st.runSteamGroupCalls.bind(st); st.runSteamGroupCalls = (c) => { window.__ran = c; window.__ranAll.push(...c); return run(c) } })()`)
  // Drag Shaod (Goons) onto the PL heading.
  const moved = await page.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.bufferlist [draggable=true]')].find((e) => e.textContent.trim().endsWith('Shaod') && e.textContent.trim().length < 12)
    const head = [...document.querySelectorAll('.bufferlist [class*=category]')].find((e) => e.textContent.trim() === 'expand_morePL')
    if (!row || !head) return { row: !!row, head: !!head }
    const dt = new DataTransfer()
    const wait = () => new Promise((r) => setTimeout(r, 150))
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
    await wait()
    head.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }))
    head.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
    await wait()
    window.__finish = () => { head.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })) }
    return { dragged: true }
  })()`)
  console.log('drag:', JSON.stringify(moved))
  await shot('steam-folders-drag.png')
  await page.evaluate(`window.__finish && window.__finish()`)
  await sleep(500)
  console.log('state:', JSON.stringify(await page.evaluate(`(() => { const st = window.__mohoShots.state(); const b = st.buffers.find((x) => x.id === 'steam:me|Shaod'); return { b: b && [b.remoteId, b.category, b.accountId], g: st.steamGroups } })()`)))
  console.log('moved:', JSON.stringify(await page.evaluate(`[window.__moved, window.__ran]`)))
  console.log('calls:', JSON.stringify(await page.evaluate(`window.__calls`)))
  // A new folder: named, and made on Steam.
  await page.evaluate(`(() => { const t = [...document.querySelectorAll('.bufferlist button')].find((b) => b.textContent.includes('Steam - me')); t && t.click() })()`)
  await sleep(300)
  await page.evaluate(`(() => { const i = [...document.querySelectorAll('.context-menu button, .context-menu [role=menuitem]')].find((e) => e.textContent.includes('New category')); i && i.click() })()`)
  await sleep(400)
  await shot('steam-folders-naming.png')
  await page.evaluate(`(() => { const inp = document.querySelector('.reason-prompt-box'); if (!inp) return; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(inp, 'Raiders'); inp.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await sleep(300)
  await page.evaluate(`(() => { const inp = document.querySelector('.reason-prompt-box'); inp && inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })()`)
  await sleep(500)
  console.log('all calls:', JSON.stringify(await page.evaluate(`window.__ranAll`)))
} finally {
  await stop()
  irc.close()
}
