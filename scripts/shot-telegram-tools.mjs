#!/usr/bin/env node
/**
 * Photographs the Telegram dialogs built for issue 26 with made-up state, in a scratch home (no Telegram account,
 * no shared daemon): a group's settings, its voice chat, a secret chat's settings, the account's profile and
 * sessions, and making a group. The daemon's answers are stood in for through `__rpcFixture`.
 *
 *   node scripts/shot-telegram-tools.mjs <output directory>
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
  console.log('wrote', name)
}
const clickTitle = (title) => page.evaluate(`(() => { const b = [...document.querySelectorAll('button[title]')].find((x) => x.title.startsWith(${JSON.stringify(title)})); b && b.click(); return !!b })()`)
const closeModal = () => page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
try {
  await openIrcChannel(page, { port: irc.address().port, nick: 'checker', channels: ['#ui'], waitFor: 'hello there' })
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await page.evaluate(`(() => {
    const now = Math.floor(Date.now() / 1000)
    window.__rpcFixture = {
      telegramChatInfo: () => ({ title: 'Lunch Club', about: 'Where we decide where to eat', broadcast: false, supergroup: true, username: 'lunchclub', memberCount: 42, isAdmin: true, isCreator: true, mayEdit: true, mayInvite: true, mayBan: true, link: 'https://t.me/+AbCdEfGh123', autoDelete: 604800, slowMode: 30, membersMaySend: true }),
      telegramBanned: () => [{ userId: '501', nick: 'Spam Bot 9000' }],
      telegramVoice: (p) => p.op === 'info' ? { active: true, call: '1:2', title: 'Friday chat', count: 3, participants: [
        { id: '11', name: 'Ada Lovelace', self: false, muted: false, canSelfUnmute: true, left: false, source: 1 },
        { id: '12', name: 'Bob', self: false, muted: true, canSelfUnmute: true, left: false, source: 2, raisedHand: true },
        { id: '13', name: 'Carol', self: false, muted: true, canSelfUnmute: true, left: false, source: 3 }] } : {},
      telegramSecretInfo: () => ({ ready: true, timer: 30, fingerprint: '7d1f0a9c3b2e44f1aa09bc7713d2e6f05c11ab90e7d3c2b1f0a9', layer: 143 }),
      telegramOwnProfile: () => ({ firstName: 'Sal', lastName: '', bio: 'Writes chat clients', username: 'salastil_example', phone: '+1 555 0100', avatarUrl: null }),
      telegramSessions: () => [
        { id: '0', app: 'moho 1.5.1', device: 'moho (linux x86_64)', place: '', ip: '', lastActive: now, current: true, unconfirmed: false },
        { id: '9', app: 'Telegram Android 11.4', device: 'Pixel 9a · Android 16', place: 'Somewhere', ip: '192.0.2.10', lastActive: now - 7200, current: false, unconfirmed: false },
        { id: '8', app: 'Telegram Desktop 5.9', device: 'Desktop · Windows 11', place: 'Somewhere', ip: '192.0.2.11', lastActive: now - 86400 * 3, current: false, unconfirmed: false }]
    }
    const s = window.__mohoShots
    const st = s.state()
    const ircAccount = st.accounts[0]
    const ircGroup = st.groups.find((g) => g.kind === 'account')
    const channel = st.buffers.find((b) => b.id.endsWith('|#ui'))
    const id = 'telegram:1000'
    const account = { ...ircAccount, id, service: 'telegram', displayName: 'Sal', state: 'connected' }
    const group = { ...ircGroup, id: 'account:' + id, accountId: id, service: 'telegram', name: 'Telegram - Sal' }
    const buffer = (bid, name, kind, remoteId, category, extra = {}) => ({ ...channel, id: id + '|' + bid, accountId: id, name, kind, remoteId, groupId: group.id, category, position: 0, unread: 0, highlight: false, mentions: 0, ...extra })
    const buffers = [
      buffer('lunch', 'Lunch Club', 'channel', '-1001234', 'Groups'),
      buffer('ada', 'Ada Lovelace', 'dm', '11', 'Direct Messages'),
      buffer('secret', '🔒 Ada Lovelace', 'dm', 'secret:77', 'Direct Messages')
    ]
    window.__tg = { id, buffers }
    s.patch({ accounts: [...st.accounts, account], groups: [...st.groups, group], buffers: [...st.buffers, ...buffers], activeGroupId: group.id, activeBufferId: buffers[0].id })
  })()`)
  await sleep(1500)

  console.log('chat settings:', await clickTitle('Chat settings'))
  await sleep(700)
  await shot('telegram-chat-settings.png')
  await closeModal()
  await sleep(300)

  console.log('voice chat:', await clickTitle('Voice chat'))
  await sleep(700)
  await shot('telegram-voice-chat.png')
  await closeModal()
  await sleep(300)

  await page.evaluate(`window.__mohoShots.patch({ activeBufferId: window.__tg.buffers[1].id })`)
  await sleep(600)
  await shot('telegram-dm-header.png')

  await page.evaluate(`window.__mohoShots.patch({ activeBufferId: window.__tg.buffers[2].id })`)
  await sleep(600)
  console.log('secret:', await clickTitle('Secret chat settings'))
  await sleep(700)
  await shot('telegram-secret-chat.png')
  await closeModal()
  await sleep(300)

  await page.evaluate(`window.__mohoShots.store.setActivePanel('accounts')`)
  await sleep(800)
  await page.evaluate(`document.querySelector('[data-account-id="telegram:1000"]')?.click()`)
  await sleep(600)
  await page.evaluate(`document.querySelector('[data-tab="service"]')?.click()`)
  await sleep(1000)
  await shot('telegram-account-profile.png')
  await page.evaluate(`[...document.querySelectorAll('.side-tabs-item')].find((b) => b.textContent.includes('Sessions'))?.click()`)
  await sleep(600)
  await shot('telegram-account-sessions.png')

  await page.evaluate(`window.__mohoShots.store.setActivePanel('join', 'telegram:1000')`)
  await sleep(1000)
  await shot('telegram-join.png')
} finally {
  await stop()
  irc.close()
}
