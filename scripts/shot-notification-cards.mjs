#!/usr/bin/env node
/**
 * Every kind of line a service writes rather than somebody saying it, beside ordinary chat and a moderation
 * card, in each layout: they must all be the same sort of card. Messages are injected; nothing is contacted.
 *
 *   node scripts/shot-notification-cards.mjs <output directory>
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
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1000, height: 760, deviceScaleFactor: 2, mobile: false })
  await ev(`(() => {
    const s = window.__mohoShots.store
    const acct = { id: 'irc:test', service: 'irc', name: 'test', host: 'irc.example', port: 6667, state: 'connected', hasPassword: false, nick: 'me' }
    const b = { id: 'irc:test|#room', accountId: 'irc:test', kind: 'channel', name: '#room', lastActivityTs: 5, groupId: 'account:irc:test' }
    const t = Math.floor(Date.now() / 1000) - 600
    const m = (i, kind, from, body, extra = {}) => ({ id: 'm' + i, bufferId: b.id, from, body, ts: t + i * 20, kind, isAction: false, isHighlight: false, isOwn: false, edited: false, ...extra })
    const messages = [
      m(1, 'join', 'alice', 'alice joined #room'),
      m(2, 'chat', 'alice', 'hello everyone'),
      m(3, 'topic', 'bob', 'bob changed the topic to: Release day'),
      m(4, 'mode', 'ChanServ', 'ChanServ sets mode +o alice'),
      m(5, 'kick', 'bob', 'bob kicked carol (spamming)'),
      m(6, 'part', 'carol', 'carol left #room'),
      m(7, 'system', 'moderation', 'This room is now in slow mode.'),
      m(8, 'moderation', 'room', 'Slow mode is on: one message every 10 seconds', { embeds: [{ kind: 'moderation', author: 'Slow mode', title: 'is on: one message every 10 seconds', icon: 'timer' }] }),
      m(9, 'chat', 'bob', 'back to normal chat')
    ]
    s.set({ accounts: [acct], groups: [{ id: 'account:irc:test', accountId: 'irc:test', service: 'irc', kind: 'account', name: 'test', position: 0 }], buffers: [b], messagesByBuffer: { [b.id]: messages }, activeBufferId: b.id })
    s.selectGroup('account:irc:test')
  })()`)
  await sleep(1200)
  for (const mode of ['comfy', 'classic', 'bubbles']) {
    await ev(`window.moho.rpc && 0; window.__mohoShots.store.setPref && window.__mohoShots.store.setPref('ui.messageLayout', ${JSON.stringify(mode)})`).catch(() => {})
    await sleep(500)
    const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(out, `notification-cards-${mode}.png`), Buffer.from(data, 'base64'))
  }
  console.log('cards', await ev(`document.querySelectorAll('.kick-event.notification').length`), 'moderation', await ev(`document.querySelectorAll('.kick-event.moderation').length`))
} finally {
  await stop()
}
