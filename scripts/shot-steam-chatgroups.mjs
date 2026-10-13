#!/usr/bin/env node
/**
 * Photographs a Steam chat group as the window shows it: a server on the rail
 * with its rooms as channels and its members listed, then the group's settings
 * dialog on each of its tabs. Made-up state on a fake IRC server, in a scratch
 * home; the daemon's answers for the group are stood in for here.
 *
 *   node scripts/shot-steam-chatgroups.mjs <output directory>
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
    const group = {
      id: '7', railId: 'steam:me|steamgroup:7', name: 'Raiders', tagline: 'Friday nights, 8pm', owner: '76561197960265729', myRank: 50, myRankWord: 'Owner',
      mayModerate: true, mayManage: true, mayInvite: true, mayChangeRoles: true, muted: false, notify: 2,
      permissions: [{ key: 'chat', label: 'Write messages' }, { key: 'kick', label: 'Remove people' }, { key: 'ban', label: 'Ban people' }, { key: 'invite', label: 'Invite people and make links' }],
      rooms: [{ id: '70', name: '', voice: false }, { id: '71', name: 'loot', voice: false }],
      roles: [{ id: '90', name: 'Member' }, { id: '91', name: 'Raid leaders' }],
      members: [
        { steamid: '76561197960265729', name: 'Gabe', rank: 50, rankWord: 'Owner', roles: ['90'] },
        { steamid: '76561197960265730', name: 'Alyx', rank: 30, rankWord: 'Moderator', roles: ['90', '91'] },
        { steamid: '76561197960265731', name: 'Eli', rank: 20, rankWord: 'Member', roles: ['90'] }
      ],
      kicked: []
    }
    window.__rpcFixture = {
      steamChatGroups: () => [group],
      steamChatGroupAction: (params) => {
        if (params.action === 'links') return { links: [{ code: 'Ga3kODnC', link: 'https://s.team/chat/Ga3kODnC', expires: 1800000000 }] }
        if (params.action === 'roleActions') return { chat: true, kick: params.roleId === '91', ban: false, invite: true }
        if (params.action === 'bans') return { bans: [{ steamid: '76561197960265800', name: 'Spammer' }] }
        return {}
      }
    }
    const s = window.__mohoShots
    const st = s.state()
    const irc = st.accounts[0]
    const account = { ...irc, id: 'steam:me', service: 'steam', displayName: 'me', state: 'connected' }
    const channel = st.buffers.find((b) => b.id.endsWith('|#ui'))
    const room = (name, id, position) => ({ ...channel, id: 'steam:me|' + name, accountId: 'steam:me', name, kind: 'channel', remoteId: '7:' + id, groupId: 'steam:me|steamgroup:7', position, unread: 0, highlight: false, mentions: 0 })
    const general = room('Raiders/#General', '70', 1)
    const loot = { ...room('Raiders/#loot', '71', 2), unread: 3 }
    s.patch({
      accounts: [...st.accounts, account],
      groups: [...st.groups, { id: 'steam:me|steamgroup:7', accountId: 'steam:me', service: 'steam', kind: 'guild', name: 'Raiders', position: 3 }],
      buffers: [...st.buffers, general, loot],
      activeBufferId: general.id, activeGroupId: 'steam:me|steamgroup:7',
      presenceByBuffer: { ...st.presenceByBuffer, [general.id]: [
        { nick: 'Gabe', status: 'online', userId: '76561197960265729', prefix: '👑', roles: ['Owner'], powerLevel: 50 },
        { nick: 'Alyx', status: 'online', userId: '76561197960265730', prefix: '🛡', roles: ['Moderator', 'Raid leaders'], powerLevel: 30, activity: { kind: 'game', text: 'Half-Life: Alyx' } },
        { nick: 'Eli', status: 'offline', away: true, userId: '76561197960265731', powerLevel: 20 }
      ] }
    })
  })()`)
  await sleep(1500)
  await shot('steam-chatgroup.png')
  console.log('channels:', JSON.stringify(await page.evaluate(`[...document.querySelectorAll('.sidebar')].map((s) => s.innerText).join('|')`)))
  // The rail entry's menu has the settings.
  await page.evaluate(`(() => { const tile = [...document.querySelectorAll('.rail-tile')].find((t) => t.getAttribute('aria-label') === 'Raiders' || t.textContent.includes('Ra')); tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 200 })) })()`)
  await sleep(400)
  const entries = await page.evaluate(`[...document.querySelectorAll('.context-menu button, .context-menu [role=menuitem]')].map((e) => e.textContent.trim())`)
  console.log('menu:', JSON.stringify(entries))
  await page.evaluate(`(() => { const item = [...document.querySelectorAll('.context-menu button, .context-menu [role=menuitem]')].find((e) => e.textContent.includes('Group settings')); item && item.click() })()`)
  await sleep(600)
  for (const tab of ['General', 'Rooms', 'People', 'Roles', 'Invites']) {
    await page.evaluate(`(() => { const t = [...document.querySelectorAll('.steam-group .room-settings-tab')].find((e) => e.textContent.trim() === ${JSON.stringify(tab)}); t && t.click() })()`)
    await sleep(500)
    if (tab === 'Roles') await page.evaluate(`(() => { const b = [...document.querySelectorAll('.steam-group button')].find((e) => e.textContent.trim() === 'Edit' ); b && b.click() })()`)
    await sleep(300)
    await shot(`steam-chatgroup-${tab.toLowerCase()}.png`)
    const box = await page.evaluate(`(() => { const r = document.querySelector('.steam-group')?.getBoundingClientRect(); return r ? [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] : null })()`)
    console.log(tab, 'dialog box', JSON.stringify(box))
  }
} finally {
  await stop()
  irc.close()
}
