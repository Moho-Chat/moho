#!/usr/bin/env node
/**
 * Photographs the member list and the direct-message rows in comfy and in
 * classic, with made-up presence on them (a game, a track, words somebody
 * wrote), so the two looks can be compared by eye.
 *
 *   node scripts/shot-userlist.mjs <output directory>
 *
 * Runs the built app against a scratch home with the screenshot hook on, and
 * a fake IRC server for something to be in.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fakeIrc, launchApp, openIrcChannel, sleep } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })

const PEOPLE = ['Crujix', 'Currington', 'dakota', 'Gremlin_magos', 'onkell', 'Salastil', 'Taylaigh']

const MEMBERS = [
  { nick: 'Crujix', status: 'idle', activity: { kind: 'game', text: 'Songs of Syx Demo' } },
  { nick: 'Currington', status: 'online', activity: { kind: 'game', text: 'Philippians 2' } },
  { nick: 'dakota', status: 'online' },
  { nick: 'Gremlin_magos', status: 'dnd', activity: { kind: 'custom', text: 'ask questions' } },
  { nick: 'onkell', status: 'online', activity: { kind: 'game', text: 'Down to Dungeon' } },
  { nick: 'Salastil', status: 'online', activity: { kind: 'music', text: 'Ramones' } },
  { nick: 'Taylaigh', status: 'offline', away: true }
]

const irc = await fakeIrc({
  people: PEOPLE,
  onJoin: (channel, _nick, send) => send(`:Crujix!u@h PRIVMSG ${channel} :hello there`)
})
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
try {
  await openIrcChannel(page, { port: irc.address().port, nick: 'checker', channels: ['#ui'], waitFor: 'hello there' })
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false })
  const shot = async (name) => {
    await sleep(600)
    const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
    console.log('wrote', name)
  }

  const dress = async () => {
      await page.evaluate(`(() => {
        const s = window.__mohoShots
        const st = s.state()
        const channel = st.buffers.find((b) => b.id.endsWith('|#ui'))
        const dm = (name, extra = {}) => ({ ...channel, id: 'irc:x|' + name, name, kind: 'dm', unread: 0, highlight: false, mentions: 0, ...extra })
        const gamer = dm('k. mardam bae')
        const quiet = dm('Alexcellence')
        s.patch({
          buffers: [...st.buffers, gamer, quiet],
          presenceByBuffer: {
            ...st.presenceByBuffer,
            [channel.id]: ${JSON.stringify(MEMBERS)},
            [gamer.id]: [{ nick: 'k. mardam bae', status: 'idle', activity: { kind: 'game', text: "Assassin's Creed Valhalla" } }],
            [quiet.id]: [{ nick: 'Alexcellence', status: 'online' }]
          }
        })
      })()`)
  }
  await dress()
  await page.evaluate(`window.moho.prefs.set('display.messageMode', 'comfy')`)
  await shot('comfy-channel.png')
  await page.evaluate(`(() => {
    const s = window.__mohoShots
    const channel = s.state().buffers.find((b) => b.id.endsWith('|#ui'))
    s.patch({ profile: { service: 'irc', accountId: channel.accountId, name: 'onkell', handle: 'onkell', status: 'online', extra: [{ label: 'Client', value: 'moho' }] } })
  })()`)
  await shot('profile-card.png')
  await page.evaluate(`(() => { window.__mohoShots.patch({ profile: null }) })()`)
  await page.evaluate(`(() => { const s = window.__mohoShots; s.store.selectGroup('~dms') })()`)
  await shot('comfy-dms.png')
  // A window is not told about its own preference change, so the new mode is
  // set, the page reloaded to read it, and the made-up state put back.
  await page.evaluate(`window.moho.prefs.set('display.messageMode', 'classic')`)
  await sleep(300)
  await page.call('Page.reload', {})
  await sleep(2500)
  await dress()
  await page.evaluate(`(() => { const s = window.__mohoShots; s.store.selectGroup('~dms') })()`)
  await shot('classic-dms.png')
  await page.evaluate(`(() => { const s = window.__mohoShots; const b = s.state().buffers.find((b) => b.id.endsWith('|#ui')); s.store.selectBuffer(b.id) })()`)
  await shot('classic-channel.png')
} finally {
  await stop()
  irc.close()
}
