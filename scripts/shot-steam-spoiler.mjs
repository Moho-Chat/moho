#!/usr/bin/env node
/**
 * Photographs a Steam conversation holding a picture and a video, each plain
 * and each sent as a spoiler. Made-up state on a fake IRC server in a scratch
 * home; Steam's addresses are answered from a generated picture and clip.
 *
 *   node scripts/shot-steam-spoiler.mjs <output directory> <picture.png> <clip.webm>
 */
import fs from 'node:fs'
import path from 'node:path'
import { fakeIrc, launchApp, openIrcChannel, sleep } from './lib/harness.mjs'

const [out = '.', picture, clip] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const irc = await fakeIrc({ people: ['alice'], onJoin: (c, _n, send) => send(`:alice!u@h PRIVMSG ${c} :hello there`) })
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
try {
  await openIrcChannel(page, { port: irc.address().port, nick: 'checker', channels: ['#ui'], waitFor: 'hello there' })
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false })
  // Steam's addresses answered here: the picture and the clip, whatever the path.
  await page.call('Fetch.enable', { patterns: [{ urlPattern: '*steamusercontent.com*' }] })
  page.on('Fetch.requestPaused', async (e) => {
    const video = e.request.url.includes('/cdn-video/') || e.request.url.includes('cdn.steamusercontent.com')
    const body = fs.readFileSync(video ? clip : picture).toString('base64')
    await page.call('Fetch.fulfillRequest', {
      requestId: e.requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: video ? 'video/webm' : 'image/png' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
      body
    })
  })
  const img = (n) => `https://images.steamusercontent.com/ugc/${n}/AAAA/`
  const vid = (n) => `https://cdn.steamusercontent.com/ugc/${n}/BBBB/`
  await page.evaluate(`(() => {
    const s = window.__mohoShots
    const st = s.state()
    const irc = st.accounts[0]
    const account = { ...irc, id: 'steam:me', service: 'steam', displayName: 'me', state: 'connected' }
    const channel = st.buffers.find((b) => b.id.endsWith('|#ui'))
    const dm = { ...channel, id: 'steam:me|Gabe', accountId: 'steam:me', name: 'Gabe', kind: 'dm', remoteId: '76561197960265829', unread: 0, highlight: false, mentions: 0 }
    const m = (id, body) => ({ id, bufferId: dm.id, from: 'Gabe', body, ts: Math.floor(Date.now() / 1000) - 600 + Number(id), isAction: false, isHighlight: false, kind: 'chat' })
    s.patch({
      accounts: [...st.accounts, account], buffers: [...st.buffers, dm], activeBufferId: dm.id, activeGroupId: '~dms',
      messagesByBuffer: { ...st.messagesByBuffer, [dm.id]: [
        m('1', 'a plain picture'), m('2', '\\n[steam:image:${img(1)}]\\n'),
        m('3', 'a picture sent as a spoiler'), m('4', '||\\n[steam:image:${img(2)}]\\n||'),
        m('5', 'a plain video'), m('6', '\\n[steam:video:${vid(3)}]\\n'),
        m('7', 'a video sent as a spoiler'), m('8', '||\\n[steam:video:${vid(4)}]\\n||')
      ] }
    })
  })()`)
  await sleep(1500)
  const shot = async (name) => {
    const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
    console.log('wrote', name)
  }
  await shot('steam-spoiler-before.png')
  console.log('covers:', await page.evaluate(`document.querySelectorAll('.spoiler-cover').length`), '| embeds:', await page.evaluate(`document.querySelectorAll('.media-embed-wrap').length`))
  await page.evaluate(`document.querySelector('.spoiler-cover')?.click()`)
  await sleep(500)
  console.log('covers after one click:', await page.evaluate(`document.querySelectorAll('.spoiler-cover').length`))
  await shot('steam-spoiler-after.png')
} finally {
  await stop()
  irc.close()
}
