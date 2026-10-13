#!/usr/bin/env node
/**
 * Photographs the Invitations tile with a Steam group invitation on it, as the window shows it.
 * Made-up state on a fake IRC server, in a scratch home.
 *
 *   node scripts/shot-steam-invite.mjs <output directory>
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
    s.patch({
      accounts: [...st.accounts, account],
      matrixInvites: { 'steam:me': [{ roomId: '79003375', name: 'Biggest Newest Moho Test', inviter: 'Salastil', avatarUrl: null, isDirect: false }] },
      activeGroupId: '~invitations'
    })
  })()`)
  await sleep(1200)
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, 'steam-invite.png'), Buffer.from(data, 'base64'))
  console.log(await page.evaluate(`document.querySelector('.invite-panel')?.innerText`))
} finally {
  await stop()
  irc.close()
}
