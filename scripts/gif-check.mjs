#!/usr/bin/env node
/**
 * Checks GIFs against the running app: that one a message carries is drawn as
 * the picture and not as its address, that a link to a page nothing could read
 * is still a link, and that the picker finds, filters and sends.
 *
 * What it stands in for, and why: Discord is not here, so the picker's list is
 * left for it (a fixture only a harness window reads) and the embeds are put on
 * messages directly. What is real is everything the window does with them, and
 * the send, which goes through the daemon to a fake IRC server and is read back
 * off the wire.
 *
 *   npm run test:gif        (builds first; needs the daemon built too)
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fakeIrc, launchApp, openIrcChannel, sleep, until, click } from './lib/harness.mjs'

let failures = 0
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : detail ? ` - ${detail}` : ''}`)
  if (!ok) failures++
}

setTimeout(() => {
  console.log('FAIL timed out')
  process.exit(1)
}, 120000).unref()

// A GIF and a video to be served, so what is drawn has something to load: made
// with ffmpeg, a second of a flat colour. The window only plays https, blob and
// data media, so they are handed to it as the last two.
const media = fs.mkdtempSync(path.join(os.tmpdir(), 'moho-gif-'))
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x3a8fe0:s=96x54:d=1:r=10', '-pix_fmt', 'yuv420p', '-y', path.join(media, 'cat.mp4')])
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xe0a43a:s=96x54:d=1:r=10', '-y', path.join(media, 'giphy.gif')])
const MP4 = fs.readFileSync(path.join(media, 'cat.mp4')).toString('base64')
const GIF = fs.readFileSync(path.join(media, 'giphy.gif')).toString('base64')

const sent = []
const irc = await fakeIrc({
  people: ['bob'],
  onJoin: (channel, _nick, send) => send(`:bob!b@h PRIVMSG ${channel} :hello there`),
  onLine: (line) => {
    if (/^PRIVMSG/i.test(line)) sent.push(line)
  }
})
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
let home = ''
try {
  home = await page.evaluate('window.moho.diagnostics?.home ?? ""').catch(() => '')
  await until(page, 'window.__mohoShots', 'the harness hook')
  await openIrcChannel(page, { port: irc.address().port, nick: 'checker', channels: ['#lobby'], waitFor: 'hello there' })

  // The same GIF, as a message that carries it.
  const SIZE = (a, b, label) =>
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="${a}"/><text x="240" y="150" font-size="60" fill="${b}" text-anchor="middle">${label}</text></svg>`)
  await page.evaluate(`(() => {
    const shots = window.__mohoShots
    const s = shots.state()
    const id = s.activeBufferId
    const now = Math.floor(Date.now() / 1000)
    const bytes = Uint8Array.from(atob('${MP4}'), (c) => c.charCodeAt(0))
    const MP4_URL = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }))
    const GIF_URL = 'data:image/gif;base64,${GIF}'
    const msg = (n, body, embeds) => ({ id: 'g' + n, bufferId: id, from: 'bob', senderId: 'bob', body, ts: now - (10 - n), isAction: false, isHighlight: false, kind: 'chat', isOwn: false, ...(embeds ? { embeds } : {}) })
    shots.patch({
      accounts: [...s.accounts, { id: 'discord:gifcheck', service: 'discord', displayName: 'x', state: 'connected', autojoin: '', currentNick: 'x', status: 'online', useTor: false, ssl: true }],
      messagesByBuffer: { ...s.messagesByBuffer, [id]: [...(s.messagesByBuffer[id] || []),
        msg(1, 'https://tenor.com/view/cat-gif-123', [{ kind: 'gif', url: 'https://tenor.com/view/cat-gif-123', mediaUrl: MP4_URL, mediaKind: 'video', width: 480, height: 270, provider: 'Tenor' }]),
        msg(2, 'look at this https://giphy.com/gifs/dog-Z7wFi5b2VEAr6 so good', [{ kind: 'gif', url: 'https://giphy.com/gifs/dog-Z7wFi5b2VEAr6', mediaUrl: GIF_URL, mediaKind: 'image', provider: 'Giphy' }]),
        msg(3, 'https://klipy.com/gifs/friends-joey-53')
      ] }
    })
    window.__gifFixture = {
      categories: [{ name: 'reaction', src: '' }, { name: 'happy', src: '' }],
      gifs: [
        { id: 'a', title: 'cat dancing', url: 'https://tenor.com/view/cat-dancing-gif-1', src: 'http://127.0.0.1:9/a.mp4', gifSrc: 'http://127.0.0.1:9/a.gif', preview: '', width: 480, height: 270 },
        { id: 'b', title: 'dog running', url: 'https://tenor.com/view/dog-running-gif-2', src: 'http://127.0.0.1:9/b.mp4', gifSrc: 'http://127.0.0.1:9/b.gif', preview: '', width: 270, height: 480 },
        { id: 'c', title: 'cat sleeping', url: 'https://tenor.com/view/cat-sleeping-gif-3', src: 'http://127.0.0.1:9/c.mp4', gifSrc: 'http://127.0.0.1:9/c.gif', preview: '', width: 480, height: 480 }
      ]
    }
    return true
  })()`)
  await sleep(800)
  const row = (n) => `[...document.querySelectorAll('.message-row')].find((r) => r.innerText.includes('${n}') || r.querySelector('[data-id="g${n}"]'))`

  // A message that carries a GIF shows the GIF, and not the address it came from.
  const rows = await page.evaluate(`[...document.querySelectorAll('.message-row')].map((r) => ({ text: r.innerText, videos: [...r.querySelectorAll('video')].map((v) => v.getAttribute('src')), plays: [...r.querySelectorAll('video')].map((v) => ({ muted: v.muted, loop: v.loop, controls: v.controls, autoplay: v.autoplay })), images: [...r.querySelectorAll('img')].map((i) => i.getAttribute('src')) }))`)
  if (process.env.GIF_DEBUG) console.log(JSON.stringify(rows.slice(-4), null, 1))
  const tenor = rows.find((r) => r.videos.some((v) => v?.startsWith('blob:')))
  check(!!tenor, 'a GIF message is drawn as a video')
  check(!!tenor && !/tenor\.com/.test(tenor.text), 'and its page address is not drawn as well', tenor?.text)
  const play = tenor?.plays?.[0]
  check(!!play && play.muted && play.loop && !play.controls && play.autoplay, 'played as a GIF: silent, going round, with no player to work', JSON.stringify(play))
  const giphy = rows.find((r) => r.text.includes('look at this'))
  check(!!giphy && /look at this/.test(giphy.text) && /so good/.test(giphy.text) && !/giphy\.com/.test(giphy.text), 'words around a GIF link stay, and the link goes', giphy?.text)
  check(!!giphy && (giphy.images.some((i) => i?.startsWith('data:image/gif'))), 'and a GIF file is drawn as a picture')
  const klipy = rows.find((r) => r.text.includes('klipy.com'))
  check(!!klipy && klipy.videos.length === 0, 'a Klipy page nothing could read stays a link', JSON.stringify(klipy))

  // The picker. It is offered only where a GIF link shows as a picture - Discord, Matrix, Kick - and none of those can be
  // stood up here, so the IRC account is shown to the window as a Matrix one: the picker appears, and what it sends still
  // goes through the daemon to the fake IRC server.
  check(!(await page.evaluate('!!document.querySelector(\'button[title="GIFs"]\')')), 'no GIF button on an IRC conversation, which would show a GIF link as a link')
  await page.evaluate(`(() => {
    const shots = window.__mohoShots
    const s = shots.state()
    const account = s.accounts.find((a) => a.id === s.buffers.find((b) => b.id === s.activeBufferId)?.accountId)
    shots.patch({ accounts: s.accounts.map((a) => (a === account ? { ...a, service: 'matrix' } : a)) })
  })()`)
  await sleep(500)
  check(await page.evaluate('!!document.querySelector(\'button[title="GIFs"]\')'), 'a GIF button is offered where a GIF link shows as a picture')
  await page.evaluate(click('button[title="GIFs"]'))
  await until(page, 'document.querySelector(".gif-picker")', 'the picker')
  check((await page.evaluate('document.querySelectorAll(".gif-cell").length')) === 3, 'it lists what it was given')
  check((await page.evaluate('document.querySelectorAll(".gif-category").length')) === 2, 'with categories to start from')
  const inView = await page.evaluate(`(() => { const r = document.querySelector('.gif-picker').getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight })()`)
  check(inView, 'inside the window')

  await page.evaluate(`(() => { const i = document.querySelector('.gif-search input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'cat'); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await sleep(700)
  check((await page.evaluate('document.querySelectorAll(".gif-cell").length')) === 2, 'a search narrows it')

  // Choosing one sends it - to IRC, the file, which anything can show as a link.
  await page.evaluate(`document.querySelector('.gif-cell[title="cat dancing"]').click()`)
  await sleep(1200)
  check(sent.some((l) => /PRIVMSG #lobby :?http:\/\/127\.0\.0\.1:9\/a\.gif/.test(l)), 'choosing one sends the file to a service that is not Discord (here IRC\'s wire, dressed as Matrix)', JSON.stringify(sent))
  check(!(await page.evaluate('!!document.querySelector(".gif-picker")')), 'and the picker closes')
} catch (e) {
  console.log('FAIL', e.message)
  failures++
} finally {
  await stop().catch(() => {})
  irc.close()
  fs.rmSync(media, { recursive: true, force: true })
}
console.log(failures ? `${failures} failed` : 'all passed')
process.exit(failures ? 1 : 0)
