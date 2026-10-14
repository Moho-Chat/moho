#!/usr/bin/env node
/**
 * Drives the sign-in window of a scratch moho without anybody signing in: after the window opens, a made-up
 * `auth-token` cookie stands in for the one a real sign-in leaves, and the window is watched to see that it is
 * taken to Twitch's approval page and kept there when something sends it back to the front page. Nothing real
 * is typed or approved; the sign-in is cancelled at the end.
 *
 *   node scripts/check-twitch-signin-window.mjs
 */
import { cdp, launchApp, sleep } from './lib/harness.mjs'

const { page, stop, port } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const ev = (code) => page.evaluate(code)
const targets = async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === 'page' && /twitch\.tv/.test(t.url))
const clickText = (selector, text) => ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) return false; b.click(); return true })()`)
try {
  await sleep(2500)
  await ev(`window.__mohoShots.store.setActivePanel('accounts')`)
  await sleep(600)
  await clickText('.service-chip', 'Twitch')
  await sleep(500)
  say('sign in', await clickText('button', 'Sign in with Twitch'))
  let t
  for (let i = 0; i < 40 && !t; i++) {
    await sleep(500)
    t = (await targets())[0]
  }
  say('window at', t?.url)
  const win = cdp(t.webSocketDebuggerUrl)
  await sleep(3000)
  await win.call('Network.enable')
  await win.call('Network.setCookie', { name: 'auth-token', value: 'madeupmadeupmadeup', domain: '.twitch.tv', path: '/', secure: true })
  say('cookie set')
  let at = ''
  for (let i = 0; i < 40 && !/activate/.test(at); i++) {
    await sleep(500)
    at = (await targets())[0]?.url ?? ''
  }
  say('window now at', at)
  // Something sends it back to the front page, as a late redirect would.
  await win.evaluate(`location.href = 'https://www.twitch.tv/'`).catch(() => {})
  const seen = []
  for (let i = 0; i < 24; i++) {
    await sleep(250)
    const u = (await targets())[0]?.url ?? ''
    const where = new URL(u).pathname
    if (seen[seen.length - 1] !== where) seen.push(where)
  }
  say('the window went', seen.join(' -> '))
  await sleep(6000)
  say('page text', JSON.stringify(await win.evaluate(`document.body.innerText.slice(0, 300)`)))
  say('inputs', JSON.stringify(await win.evaluate(`[...document.querySelectorAll('input')].map((i) => ({ type: i.type, name: i.name, id: i.id, ph: i.placeholder, max: i.maxLength, value: i.value, shown: i.getClientRects().length > 0 }))`)))
  win.close()
} finally {
  await stop()
}
