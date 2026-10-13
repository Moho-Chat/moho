#!/usr/bin/env node
/**
 * Photographs Steam voice as the window shows it: a group's voice room with people in
 * it, the panel for the call you are in, and a call ringing. Made-up state on a fake IRC
 * server, in a scratch home.
 *
 *   node scripts/shot-steam-voice.mjs <output directory>
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
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await page.evaluate(`(() => {
    const s = window.__mohoShots
    const st = s.state()
    const account = { ...st.accounts[0], id: 'steam:me', service: 'steam', displayName: 'me', state: 'connected' }
    const channel = st.buffers.find((b) => b.id.endsWith('|#ui'))
    const room = (name, id, position) => ({ ...channel, id: 'steam:me|' + name, accountId: 'steam:me', name, kind: 'channel', remoteId: '7:' + id, groupId: 'steam:me|steamgroup:7', position, unread: 0, highlight: false, mentions: 0 })
    const dm = { ...channel, id: 'steam:me|Gabe', accountId: 'steam:me', name: 'Gabe', kind: 'dm', remoteId: '76561197960265729', unread: 0, highlight: false, mentions: 0 }
    const general = room('Raiders/#General', '70', 1)
    const talk = room('Raiders/#Lounge', '71', 2)
    const live = s.store.steamVoiceLive
    live.speakers = new Set(['76561197960265730'])
    live.statuses = new Map([['76561197960265731', { micMuted: true, outputMuted: false, noMic: false }]])
    live.level = 0.4
    live.rttMs = 23
    s.patch({
      accounts: [...st.accounts, account],
      groups: [...st.groups, { id: 'steam:me|steamgroup:7', accountId: 'steam:me', service: 'steam', kind: 'guild', name: 'Raiders', position: 3 }],
      buffers: [...st.buffers, general, talk, dm],
      activeBufferId: general.id, activeGroupId: 'steam:me|steamgroup:7',
      steamVoiceRooms: { 'steam:me|7': [{ roomId: '71', bufferId: talk.id, name: 'Lounge', members: [
        { userId: '76561197960265729', nick: 'Gabe' },
        { userId: '76561197960265730', nick: 'Alyx' },
        { userId: '76561197960265731', nick: 'Eli' },
        { userId: '76561197960287930', nick: 'me', isSelf: true }
      ] }] },
      steamVoiceNow: { accountId: 'steam:me', phase: 'connected', target: { kind: 'room', groupId: '7', roomId: '71', bufferId: talk.id, name: 'Lounge', groupName: 'Raiders', railId: 'steam:me|steamgroup:7' } },
      voiceSessions: [{ accountId: 'steam:me', channelId: '71', channelName: 'Lounge', isDirect: false, bufferId: talk.id, railId: 'steam:me|steamgroup:7' }],
      steamRings: [{ accountId: 'steam:me', steamid: '76561197960265729', voiceChatId: '99' }]
    })
  })()`)
  // The window asks the daemon who is in the voice rooms when the group opens, and the
  // daemon knows no such group: the made-up answer goes in after that.
  await sleep(1200)
  await page.evaluate(`(() => { const s = window.__mohoShots; s.patch({ steamVoiceRooms: { 'steam:me|7': [{ roomId: '71', bufferId: 'steam:me|Raiders/#Lounge', name: 'Lounge', members: [{ userId: '76561197960265729', nick: 'Gabe' }, { userId: '76561197960265730', nick: 'Alyx' }, { userId: '76561197960265731', nick: 'Eli' }, { userId: '76561197960287930', nick: 'me', isSelf: true }] }] } }) })()`)
  await sleep(800)
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, 'steam-voice.png'), Buffer.from(data, 'base64'))
  console.log('panel:', JSON.stringify(await page.evaluate(`document.querySelector('.voice-panel')?.innerText`)))
  console.log('ring:', JSON.stringify(await page.evaluate(`document.querySelector('.incoming-call')?.innerText`)))
} finally {
  await stop()
  irc.close()
}
