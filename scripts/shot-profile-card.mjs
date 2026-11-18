#!/usr/bin/env node
/**
 * Photographs the profile card (#339, the popover with a cover): opened from a member in the list, opened on
 * hovering over a name in the log, and an IRC nick's. Made-up state on a fake IRC server, in a scratch home.
 *
 *   node scripts/shot-profile-card.mjs <output directory>
 */
import fs from 'node:fs'
import path from 'node:path'
import { fakeIrc, launchApp, openIrcChannel, sleep } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const irc = await fakeIrc({ people: ['alice', 'bob', 'dave'], onJoin: (c, _n, send) => { send(`:alice!u@h PRIVMSG ${c} :the train belt is done`); send(`:bob!u@h PRIVMSG ${c} :nice`) } })
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const shot = async (name) => {
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
  console.log('wrote', name)
}
/** The card, put up as the store would after an answer, beside the element `selector` finds by its text. */
const show = (profile, selector, text, hover) =>
  page.evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.includes(${JSON.stringify(text)}))
    const r = el ? el.getBoundingClientRect() : null
    window.__mohoShots.patch({ profile: ${JSON.stringify(profile)}, profileAnchor: r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null, profileHover: ${hover} })
    return !!el
  })()`)
const ada = (accountId) => ({
  service: 'discord', accountId, id: '42', name: 'Ada Lovelace', handle: 'ada', status: 'online',
  activity: { kind: 'game', text: 'Factorio' },
  roles: ['Admin', 'Builder', 'Regular', 'Nitro booster'], isModerator: true,
  joinedTs: 1678752000, createdTs: 1546387200, lastActiveTs: Math.floor(Date.now() / 1000) - 60,
  nameHistory: [{ name: 'adal', when: '2024' }, { name: 'countess_of_code', when: '2022' }]
})
try {
  await openIrcChannel(page, { port: irc.address().port, nick: 'checker', channels: ['#general'], waitFor: 'nice' })
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await sleep(800)
  const accountId = await page.evaluate(`window.__mohoShots.state().accounts[0].id`)
  console.log('member:', await show(ada(accountId), '.nick-row', 'alice', false))
  await sleep(700)
  await shot('profile-card-pinned.png')
  console.log('hover:', await show(ada(accountId), '.message-from', 'alice', true))
  await sleep(700)
  await shot('profile-card-hover.png')
  const dave = { service: 'irc', accountId, name: 'dave', handle: 'dave!~dave@user/dave', idleSeconds: 734, joinedTs: Math.floor(Date.now() / 1000) - 86400 * 3, channels: ['#general', '#rust', '#moho', '#electron'], roles: ['Operator in #general'], extra: [{ label: 'Real name', value: 'Dave Example' }, { label: 'Server', value: 'tantalum.libera.chat' }] }
  console.log('irc:', await show(dave, '.nick-row', 'dave', false))
  await sleep(700)
  await shot('profile-card-irc.png')
} finally {
  await stop()
  irc.close()
}
