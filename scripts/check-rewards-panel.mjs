#!/usr/bin/env node
/**
 * The channel points panel over the chat, for Twitch and for Kick, in a scratch moho with the daemon's answers
 * stood in for (nothing is contacted, nothing spent): it opens from the plaque, lists the rewards with their
 * costs, says why one cannot be pressed, needs a second press to spend, asks for the text a reward wants, and
 * closes on Escape.
 *
 *   node scripts/check-rewards-panel.mjs <output directory>
 */
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, sleep } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const ev = (code) => page.evaluate(code)
const shot = async (name) => {
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
}
const results = []
const check = (what, ok, detail = '') => {
  results.push(ok)
  console.log(ok ? '  ok  ' : '  FAIL', what, detail)
}
const key = (k) => page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k }).then(() => page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k }))
try {
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false })
  await ev(`(() => {
    window.__redeemed = []
    window.__rpcFixture = {
      listTwitchRewards: () => ({ points: 600, name: 'Sloths', rewards: [
        { id: 'r1', title: 'Drink water', cost: 500, description: null, enabled: true, paused: false, needsInput: false },
        { id: 'r2', title: 'Say a name', cost: 100, description: 'Who?', enabled: true, paused: false, needsInput: true },
        { id: 'r3', title: 'Dance', cost: 50, description: null, enabled: true, paused: true, needsInput: false },
        { id: 'r4', title: 'Costly', cost: 9000, description: null, enabled: true, paused: false, needsInput: false },
        { id: 'a1', title: 'Choose an Emote to Unlock', cost: 480, description: 'Pick a subscriber emote to unlock for 24 hours', enabled: true, paused: false, needsInput: false, choices: [{ id: 'e1', label: 'binxbWut' }, { id: 'e2', label: 'binxbYAP' }] },
        { id: 'a3', title: 'Modify a Single Emote', cost: 550, description: null, enabled: true, paused: false, needsInput: false, choices: [{ id: 'e1_BW', label: 'binxbWut, black and white', group: 'binxbWut', groupImage: null }, { id: 'e1_SG', label: 'binxbWut, with sunglasses', group: 'binxbWut', groupImage: null }, { id: 'e2_SG', label: 'binxbYAP, with sunglasses', group: 'binxbYAP', groupImage: null }] },
        { id: 'a2', title: 'Sub-only', cost: 350, description: null, enabled: true, paused: false, needsInput: false, unavailable: 'Send this one from twitch.tv chat box' } ] }),
      redeemTwitchReward: (p) => { window.__redeemed.push(p); return { points: 600 } },
      listKickRewards: () => ({ points: 1200, rewards: [ { id: 'k1', title: 'Hydrate', cost: 300, enabled: true, paused: false, needsInput: false }, { id: 'k2', title: 'Type something', cost: 100, enabled: true, paused: false, needsInput: true } ] }),
      redeemKickReward: (p) => { window.__redeemed.push(p); return { points: 900 } },
      twitchPoints: () => ({ points: 600, name: 'Sloths' }),
      kickPoints: () => ({ points: 1200 })
    }
    const s = window.__mohoShots.store
    const pic = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#7b5cd6"/></svg>')
    const accts = [
      { id: 'twitch:me', service: 'twitch', name: 'me', host: '', port: 0, state: 'connected', hasPassword: true, webSession: true, nick: 'me' },
      { id: 'kick:me', service: 'kick', name: 'me', host: '', port: 0, state: 'connected', hasPassword: true, nick: 'me' }
    ]
    const bufs = [
      { id: 'twitch:me|xqc', accountId: 'twitch:me', kind: 'channel', name: 'xqc', lastActivityTs: 5, avatarUrl: pic, groupId: 'account:twitch:me' },
      { id: 'kick:me|spreen', accountId: 'kick:me', kind: 'channel', name: 'spreen', lastActivityTs: 5, avatarUrl: pic, groupId: 'account:kick:me' }
    ]
    s.set({ accounts: accts, groups: accts.map((a, i) => ({ id: 'account:' + a.id, accountId: a.id, service: a.service, kind: 'account', name: 'me', position: i })), buffers: bufs, activeBufferId: 'twitch:me|xqc', twitchPoints: { 'twitch:me|xqc': { points: 600, name: 'Sloths' } }, kickPointsByBuffer: { 'kick:me|spreen': 1200 } })
    s.selectGroup('account:twitch:me')
  })()`)
  await sleep(1500)

  await ev(`window.__errs = []; window.addEventListener('error', (e) => window.__errs.push(String(e.message))); window.addEventListener('unhandledrejection', (e) => window.__errs.push('rej ' + String(e.reason)))`)
  console.log('Twitch')
  const plaque = `document.querySelector('.kick-points-plaque')`
  check('the plaque shows the balance with the channel\'s name for its points', await ev(`${plaque}?.innerText.includes('600 Sloths')`))
  await ev(`${plaque}.click()`)
  await sleep(600)
  check('a panel opens over the chat', await ev(`!!document.querySelector('.switcher.rewards')`))
  check('it lists the four rewards, cheapest first within the ones that can be had, then the ones that cannot', await ev(`JSON.stringify([...document.querySelectorAll('.reward-row')].map((r) => r.querySelector('.reward-cost').innerText)) === JSON.stringify(['100', '480', '500', '550', '50', '350', '9,000'])`))
  check('under two headings', await ev(`JSON.stringify([...document.querySelectorAll('.reward-group')].map((h) => h.innerText.toLowerCase())) === JSON.stringify(['available', 'unavailable'])`))
  check('a paused reward and an unaffordable one are disabled with the reason', await ev(`(() => { const r = [...document.querySelectorAll('.reward-row')]; return r.slice(0, 4).every((x) => !x.disabled) && r[4].disabled && r[4].innerText.includes('Paused') && r[5].disabled && r[5].innerText.includes('twitch.tv chat box') && r[6].disabled && r[6].innerText.includes('You have 600 of 9,000') })()`))
  await shot('rewards-twitch.png')
  await ev(`document.querySelectorAll('.reward-row')[2].click()`)
  await sleep(300)
  check('the first press arms it and spends nothing', await ev(`!!document.querySelector('.reward-confirm') && window.__redeemed.length === 0`))
  await ev(`document.querySelector('.reward-confirm .button.primary').click()`)
  await sleep(500)
  check('Redeem spends it', await ev(`window.__redeemed.length === 1 && window.__redeemed[0].rewardId === 'r1'`))
  await ev(`document.querySelectorAll('.reward-row')[0].click()`)
  await sleep(300)
  check('a reward that asks for text shows its field, and Redeem waits for it', await ev(`!!document.querySelector('.reward-confirm input') && document.querySelector('.reward-confirm .button.primary').disabled`))
  await page.call('Input.insertText', { text: 'Greg' })
  await sleep(200)
  await ev(`document.querySelector('.reward-confirm .button.primary').click()`)
  await sleep(500)
  check('what was typed goes with it', await ev(`window.__redeemed[1]?.input === 'Greg'`))
  await ev(`document.querySelectorAll('.reward-row')[1].click()`)
  await sleep(300)
  check('an emote unlock shows the emotes to press, with a search, and Redeem waits for one', await ev(`!document.querySelector('.reward-confirm select') && document.querySelectorAll('.reward-confirm .reward-emote').length === 2 && !!document.querySelector('.reward-confirm input[placeholder="Search emotes"]') && document.querySelector('.reward-confirm .button.primary').disabled`))
  await ev(`document.querySelector('.reward-confirm .reward-emote[title="binxbYAP"]').click()`)
  await sleep(200)
  check('pressing one picks it', await ev(`!document.querySelector('.reward-confirm .button.primary').disabled && document.querySelector('.reward-emote.selected')?.title === 'binxbYAP'`))
  await ev(`document.querySelector('.reward-confirm .button.primary').click()`)
  await sleep(500)
  check('the emote picked goes with it', await ev(`window.__redeemed[2]?.rewardId === 'a1' && window.__redeemed[2]?.choice === 'e2'`))
  await ev(`[...document.querySelectorAll('.reward-row')].find((r) => r.innerText.includes('Modify a Single Emote')).click()`)
  await sleep(300)
  check('a change to an emote shows the emotes first', await ev(`[...document.querySelectorAll('.reward-confirm .reward-emote')].map((b) => b.title).join() === 'binxbWut,binxbYAP'`))
  await ev(`document.querySelector('.reward-confirm .reward-emote[title="binxbWut"]').click()`)
  await sleep(200)
  check('then what can be done to the one picked', await ev(`[...document.querySelectorAll('.reward-confirm .reward-emote')].map((b) => b.title).join() === 'binxbWut, black and white,binxbWut, with sunglasses'`))
  await ev(`document.querySelector('.reward-confirm .reward-emote[title="binxbWut, with sunglasses"]').click()`)
  await sleep(200)
  await ev(`document.querySelector('.reward-confirm .button.primary').click()`)
  await sleep(500)
  check('the change picked goes with it', await ev(`window.__redeemed[3]?.rewardId === 'a3' && window.__redeemed[3]?.choice === 'e1_SG'`))
  await key('Escape')
  await sleep(300)
  check('Escape closes the panel', await ev(`!document.querySelector('.switcher.rewards')`))

  console.log('Kick')
  await ev(`window.__mohoShots.store.selectGroup('account:kick:me'); window.__mohoShots.store.selectBuffer('kick:me|spreen', true)`)
  await sleep(1200)
  await ev(`document.querySelector('.kick-points-plaque')?.click()`)
  await sleep(600)
  check('Kick opens the same panel', await ev(`!!document.querySelector('.switcher.rewards') && document.querySelectorAll('.reward-row').length === 2`))
  check('a Kick reward that asks for text is disabled with a reason', await ev(`(() => { const r = document.querySelectorAll('.reward-row')[1]; return r.disabled && r.innerText.includes('cannot do') })()`))
  await shot('rewards-kick.png')
} finally {
  await stop()
}
console.log(results.every(Boolean) ? 'ALL OK' : `${results.filter((r) => !r).length} FAILED`)
