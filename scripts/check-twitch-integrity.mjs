#!/usr/bin/env node
/**
 * Makes a Twitch integrity token the way the app does when Twitch asks for one - in a hidden page on
 * twitch.tv, from main - and then uses it for a stream's playback token from outside the page, to show the
 * token is the kind Twitch's GraphQL takes.
 *
 *   node scripts/check-twitch-integrity.mjs
 */
import { cdp, freePort, launchApp, sleep } from './lib/harness.mjs'

const inspectPort = await freePort()
const { stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' }, args: [`--inspect=${inspectPort}`] })
try {
  let main = null
  for (let i = 0; i < 60 && !main; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${inspectPort}/json/list`)).json()
      const target = list.find((t) => t.webSocketDebuggerUrl)
      if (target) main = cdp(target.webSocketDebuggerUrl)
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }
  if (!main) throw new Error('main never offered its inspector')
  for (let i = 0; i < 40 && !(await main.evaluate('!!globalThis.__mohoTwitchIntegrity').catch(() => false)); i++) await sleep(500)
  const device = `check${Math.random().toString(16).slice(2, 14)}`
  const t0 = Date.now()
  const made = await main.evaluate(`globalThis.__mohoTwitchIntegrity.mint(${JSON.stringify(device)})`)
  console.log(`made in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, { prefix: made.token.slice(0, 9), length: made.token.length, goodForHours: +((made.expiration - Date.now()) / 3600000).toFixed(1) })
  // From outside any page: the player's own token query, with the integrity token and the device it was made for.
  const res = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko', 'Content-Type': 'text/plain;charset=UTF-8', 'X-Device-Id': device, 'Client-Integrity': made.token },
    body: JSON.stringify({ operationName: 'PlaybackAccessToken', variables: { isLive: true, login: 'xqc', isVod: false, vodID: '', playerType: 'site', platform: 'web' }, extensions: { persistedQuery: { version: 1, sha256Hash: 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9' } } })
  })
  const body = await res.json()
  const token = body?.data?.streamPlaybackAccessToken
  console.log('playback token call', res.status, token ? `token for device ${JSON.parse(token.value).device_id}` : JSON.stringify(body).slice(0, 200))
} finally {
  await stop()
}
