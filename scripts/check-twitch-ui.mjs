#!/usr/bin/env node
/**
 * The Twitch parts of the window, in a scratch moho with injected state (nothing is contacted): the list's fixed
 * headings, whispers' badge, Settings -> Twitch, Ctrl+K finding a Twitch channel, readable name colours, emotes
 * and cheers drawn as pictures, links, and a signed-in account's composer with no GIF button.
 *
 *   node scripts/check-twitch-ui.mjs <output directory>
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
const key = (k, mods = 0) => page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k.length === 1 ? 'Key' + k.toUpperCase() : k, modifiers: mods, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0 }).then(() => page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, modifiers: mods }))
try {
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false })
  await ev(`(() => {
    const s = window.__mohoShots.store
    const acct = { id: 'twitch:me', service: 'twitch', name: 'me', host: '', port: 0, state: 'connected', hasPassword: true, webSession: true, moderation: true, nick: 'me' }
    const pic = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#7b5cd6"/></svg>')
    const mk = (name, kind, t, cat) => ({ id: 'twitch:me|' + name, accountId: 'twitch:me', kind, name, lastActivityTs: t, avatarUrl: pic, category: cat, groupId: 'account:twitch:me' })
    const buffers = [mk('xqc', 'channel', 5, 'Channels'), mk('skitzy_va', 'channel', 4, 'Channels'), mk('@friend', 'dm', 6, 'Direct Messages')]
    const t = Math.floor(Date.now() / 1000) - 600
    const m = (i, from, body, extra = {}) => ({ id: 'm' + i, bufferId: 'twitch:me|xqc', from, body, ts: t + i * 20, kind: 'chat', isAction: false, isHighlight: false, isOwn: false, edited: false, ...extra })
    const messages = [
      m(1, 'darkblue', 'a very dark colour name', { senderColor: '#0000FF' }),
      m(2, 'pinkie', 'with an emote [twitch:emote:25:Kappa] and a moving [twitch:aemote:emotesv2_abc:Dance] one'),
      m(3, 'whale', 'cheered [twitch:cheer:cheer:100] for the stream', {}),
      m(4, 'linker', 'see https://example.com/page for details'),
      m(5, 'newbie', 'first message here', { firstMessage: true })
    ]
    s.set({ accounts: [acct], groups: [{ id: 'account:twitch:me', accountId: 'twitch:me', service: 'twitch', kind: 'account', name: 'me', position: 0 }], buffers, messagesByBuffer: { 'twitch:me|xqc': messages }, activeBufferId: 'twitch:me|xqc' })
    s.selectGroup('account:twitch:me')
  })()`)
  await sleep(1500)

  console.log('Channel list')
  const rows = await ev(`[...document.querySelectorAll('.category, .buffer-row')].map((r) => r.innerText.replace(/\\n/g, ' ').trim())`)
  check('fixed headings with the whisper under Direct Messages', JSON.stringify(rows).includes('DIRECT MESSAGES') && JSON.stringify(rows).includes('CHANNELS'), JSON.stringify(rows))
  check('the whisper row has the mail badge', await ev(`!!document.querySelector('.avatar-badge')`), await ev(`[...document.querySelectorAll('.buffer-row')].map((r) => r.innerHTML.slice(0, 200)).join(' || ')`))

  console.log('Messages')
  check('a very dark name colour is made readable', await ev(`(() => { const e = [...document.querySelectorAll('.message-sender, .message-from, .sender')].find((x) => x.textContent.includes('darkblue')); if (!e) return false; const m = getComputedStyle(e).color.match(/\\d+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) > 90 })()`))
  check('emotes are pictures', (await ev(`document.querySelectorAll('.message-row img[src*="emoticons"], .message-row img.custom-emoji').length`)) >= 2, String(await ev(`[...document.querySelectorAll('.message-row img')].map((i) => i.src.slice(0, 60)).join(' | ')`)))
  check('a cheer is drawn with its amount', await ev(`document.body.innerText.includes('100')`))
  check('a link is a link', await ev(`!!document.querySelector('.message-row a[href^="https://example.com"], .message-row .link')`))
  await shot('twitch-messages.png')

  console.log('Composer')
  check('the signed-in composer has an emoji button and no GIF button', await ev(`!!document.querySelector('button[title="Emoji"]') && !document.querySelector('button[title="GIFs"]')`))

  console.log('Ctrl+K')
  await key('k', 2)
  await sleep(600)
  const opened = await ev(`!!document.querySelector('input[placeholder*="Where"], .switcher, [role="dialog"] input')`)
  check('the quick switcher opens', opened)
  if (opened) {
    await ev(`(() => { const i = document.querySelector('.switcher input, [role="dialog"] input, input[placeholder*="Where"]'); i.focus() })()`)
    await page.call('Input.insertText', { text: 'skitz' })
    await sleep(500)
    check('it finds a Twitch channel by name', await ev(`document.body.innerText.includes('skitzy_va')`))
    await key('Escape')
    await sleep(300)
  }

  console.log('Settings')
  await ev(`window.__mohoShots.store.setActivePanel('settings')`)
  await sleep(800)
  const clicked = await ev(`(() => { const b = [...document.querySelectorAll('button, [role=tab], a')].find((x) => x.textContent.trim() === 'Twitch'); if (!b) return false; b.click(); return true })()`)
  check('Settings has a Twitch page', clicked)
  await sleep(600)
  const text = await ev(`document.body.innerText`)
  for (const want of ['What to show besides chat', 'Badges', 'Watching', 'Polls, predictions and raids', 'Recent messages']) check(`Settings -> Twitch has "${want}"`, text.includes(want))
  await shot('twitch-settings.png')
} finally {
  await stop()
}
console.log(results.every(Boolean) ? 'ALL OK' : `${results.filter((r) => !r).length} FAILED`)
