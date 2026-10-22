#!/usr/bin/env node
/**
 * The line above a reply, and the bar over the box while one is written, in a scratch moho with injected state
 * (nothing is contacted): what the reply quotes is drawn as the original is - an emote or emoji as its picture, not
 * its code - on every service that has such codes, and text that has none is untouched.
 *
 *   node scripts/check-reply-emotes.mjs [output directory]
 */
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, sleep } from './lib/harness.mjs'

const out = process.argv[2]
if (out) fs.mkdirSync(out, { recursive: true })
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const ev = (code) => page.evaluate(code)
const results = []
const check = (what, ok, detail = '') => {
  results.push(ok)
  console.log(ok ? '  ok  ' : '  FAIL', what, ok ? '' : detail)
}

// What each service's stored text carries for a picture, and what must not be left on screen.
const CASES = [
  { service: 'kick', body: '[emote:5756632:SUSSY][emote:5756632:SUSSY] lol', code: '[emote:', pictures: 2 },
  { service: 'discord', body: 'nice <:pog:123456789012345678> yes', code: '<:pog', pictures: 1 },
  { service: 'twitch', body: '[twitch:emote:25:Kappa] hello', code: '[twitch:', pictures: 1 },
  // Twitch quotes the parent as plain text, with no word of which are emotes: the original on screen has them.
  { service: 'twitch', body: '[twitch:emote:25:Kappa] hello', quotedAs: 'Kappa hello', code: '[twitch:', pictures: 1 },
  { service: 'steam', body: '[steam:emote:steamhappy] hi', code: '[steam:', pictures: 1 },
  { service: 'sneedchat', body: 'hello :smile: there', code: null, pictures: 0 },
  { service: 'matrix', body: 'plain 😀 words', code: null, pictures: 0 },
  { service: 'irc', body: 'plain 😀 words', code: null, pictures: 0 },
  { service: 'telegram', body: 'plain 😀 words', code: null, pictures: 0 }
]
try {
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  for (const c of CASES) {
    console.log(c.service)
    await ev(`(() => {
      const s = window.__mohoShots.store
      const id = ${JSON.stringify(c.service + ':me')}
      const acct = { id, service: ${JSON.stringify(c.service)}, name: 'me', host: '', port: 0, state: 'connected', hasPassword: true, nick: 'me' }
      const buf = { id: id + '|room', accountId: id, kind: 'channel', name: 'room', lastActivityTs: 5, category: 'Channels', groupId: 'account:' + id }
      const t = Math.floor(Date.now() / 1000) - 600
      const base = { bufferId: buf.id, ts: t, kind: 'chat', isAction: false, isHighlight: false, isOwn: false, edited: false }
      const messages = [
        { ...base, id: 'o1', from: 'TAYL31GH', senderId: 't', body: ${JSON.stringify(c.body)} },
        { ...base, id: 'r1', from: 'RildWandy', senderId: 'r', ts: t + 30, body: 'I shit you not lol', replyTo: { id: 'o1', from: 'TAYL31GH', body: ${JSON.stringify(c.quotedAs ?? c.body)}${c.service === 'telegram' ? ", chat: ''" : ''} } }
      ]
      s.set({ accounts: [acct], groups: [{ id: 'account:' + id, accountId: id, service: ${JSON.stringify(c.service)}, kind: 'account', name: 'me', position: 0 }], buffers: [buf], messagesByBuffer: { [buf.id]: messages }, activeBufferId: buf.id })
      s.selectGroup('account:' + id)
    })()`)
    await sleep(900)
    const preview = await ev(`(() => {
      const el = document.querySelector('.reply-preview, .tg-quote-body')
      return el ? { text: el.innerText, pictures: el.querySelectorAll('img.custom-emoji, img.smilie, .custom-emoji-gone').length, html: el.innerHTML.slice(0, 200) } : null
    })()`)
    check(`${c.service}: the reply shows what it answers`, !!preview)
    if (!preview) continue
    if (c.code) check(`${c.service}: and not the emote's code`, !preview.text.includes(c.code) && !preview.html.includes(c.code), JSON.stringify(preview))
    if (c.pictures) check(`${c.service}: as ${c.pictures} picture(s)`, preview.pictures === c.pictures, JSON.stringify(preview))
    else check(`${c.service}: its words are kept`, /plain|hello/.test(preview.text), JSON.stringify(preview))
    if (c.service === 'kick') {
      console.log('The bar over the box')
      await ev(`window.__mohoShots.store.startReply('o1', 'TAYL31GH', '[emote:5756632:SUSSY] lol')`)
      await sleep(600)
      const bar = await ev(`(() => { const el = document.querySelector('.composer-reply'); return el ? { text: el.innerText, pictures: el.querySelectorAll('img.custom-emoji, .custom-emoji-gone').length } : null })()`)
      check('the bar over the box draws the emote too', !!bar && bar.pictures === 1 && !bar.text.includes('[emote:'), JSON.stringify(bar))
      await ev(`window.__mohoShots.store.set({ replyingTo: null })`)
    }
    if (c.service === 'kick' && out) {
      const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(out, 'reply-emotes-kick.png'), Buffer.from(data, 'base64'))
    }
  }

} catch (e) {
  console.log('  FAIL', e.message)
  results.push(false)
} finally {
  await stop()
}
process.exit(results.every(Boolean) ? 0 : 1)
