#!/usr/bin/env node
/**
 * Searching the web for selected text, in a scratch moho with injected state (nothing is contacted): the message
 * menu offers it for a selection only, names the engine chosen in Settings > General, follows a change of engine,
 * and Settings shows the drop-down (and the address field for an engine of one's own).
 *
 *   node scripts/check-search-menu.mjs [output directory]
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
const shot = async (name) => {
  if (!out) return
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
}
const mouse = (type, x, y, button = 'left') => page.call('Input.dispatchMouseEvent', { type, x, y, button, buttons: type === 'mouseReleased' ? 0 : button === 'right' ? 2 : 1, clickCount: 1 })
const menuLabels = () => ev(`[...document.querySelectorAll('.context-menu .context-menu-item')].map((e) => e.innerText.trim().split('\\n').pop())`)
/** Sets a field the way a person's edit does, so the window's own handlers run. */
const setField = (selector, value, how) => ev(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return false
  if (${JSON.stringify(how)} === 'input') el.focus()
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
  el.dispatchEvent(new Event(${JSON.stringify(how)}, { bubbles: true }))
  if (${JSON.stringify(how)} === 'input') el.blur()
  return true
})()`)
const openGeneral = async () => {
  await ev(`window.__mohoShots.store.setActivePanel('settings')`)
  await sleep(500)
  await ev(`(() => { const b = [...document.querySelectorAll('button, [role=tab], a')].find((e) => e.innerText.trim() === 'General'); b?.click() })()`)
  await sleep(500)
}
const closeMenu = async () => {
  await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(200)
}
/** Selects `needle` in the first message and right-clicks on it. */
const rightClickOn = async (needle) => {
  const at = await ev(`(() => {
    const body = document.querySelector('.message-body') ?? document.querySelector('[data-msg-id]')
    const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    for (let n; (n = w.nextNode()); ) {
      const i = n.nodeValue.indexOf(${JSON.stringify(needle)})
      if (i < 0) continue
      const r = document.createRange()
      r.setStart(n, i); r.setEnd(n, i + ${JSON.stringify(needle)}.length)
      const s = getSelection(); s.removeAllRanges(); s.addRange(r)
      const b = r.getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    }
    return null
  })()`)
  if (!at) return false
  await mouse('mouseMoved', at.x, at.y)
  await mouse('mousePressed', at.x, at.y, 'right')
  await mouse('mouseReleased', at.x, at.y, 'right')
  await sleep(400)
  return true
}
try {
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await ev(`(() => {
    const s = window.__mohoShots.store
    const acct = { id: 'discord:me', service: 'discord', name: 'me', host: '', port: 0, state: 'connected', hasPassword: true, nick: 'me' }
    const buf = { id: 'discord:me|chat', accountId: 'discord:me', kind: 'channel', name: 'chat', lastActivityTs: 5, category: 'Channels', groupId: 'account:discord:me' }
    const t = Math.floor(Date.now() / 1000) - 600
    const messages = [{ id: 'm1', bufferId: 'discord:me|chat', from: 'ada', body: 'the Antikythera mechanism is older than anyone expected', ts: t, kind: 'chat', isAction: false, isHighlight: false, isOwn: false, edited: false }]
    s.set({ accounts: [acct], groups: [{ id: 'account:discord:me', accountId: 'discord:me', service: 'discord', kind: 'account', name: 'me', position: 0 }], buffers: [buf], messagesByBuffer: { 'discord:me|chat': messages }, activeBufferId: 'discord:me|chat' })
    s.selectGroup('account:discord:me')
  })()`)
  await sleep(1200)

  console.log('Message menu')
  check('a message with a word selected', await rightClickOn('Antikythera mechanism'))
  let labels = await menuLabels()
  check('offers a search for it, by the default engine', labels.some((l) => l === 'Search DuckDuckGo for “Antikythera mechanism”'), JSON.stringify(labels))
  await shot('search-menu.png')
  await closeMenu()

  await openGeneral()
  check('Settings > General has the engine drop-down', await setField('select[aria-label="Search engine"]', 'google', 'change'))
  await sleep(300)
  await ev(`window.__mohoShots.store.setActivePanel('')`)
  await sleep(500)
  await rightClickOn('Antikythera mechanism is older')
  labels = await menuLabels()
  check('names the engine chosen in Settings, and shortens a long selection', labels.some((l) => /^Search Google for “Antikythera mechanism is ol…”$/.test(l)), JSON.stringify(labels))
  await closeMenu()

  await openGeneral()
  await setField('select[aria-label="Search engine"]', 'custom', 'change')
  await sleep(300)
  check('an own engine asks for an address', await setField('input[placeholder="https://example.org/search?q=%s"]', 'https://www.example.org/find?q=%s', 'input'))
  await shot('search-settings.png')
  await sleep(300)
  await ev(`window.__mohoShots.store.setActivePanel('')`)
  await sleep(500)
  await rightClickOn('Antikythera')
  labels = await menuLabels()
  check('an engine of one’s own is named by its host', labels.some((l) => l === 'Search example.org for “Antikythera”'), JSON.stringify(labels))
  await closeMenu()

  await openGeneral()
  await setField('input[placeholder="https://example.org/search?q=%s"]', 'nonsense', 'input')
  await sleep(300)
  await ev(`window.__mohoShots.store.setActivePanel('')`)
  await sleep(500)
  await rightClickOn('Antikythera')
  labels = await menuLabels()
  check('an address that cannot be searched is not offered', !labels.some((l) => l.startsWith('Search ')), JSON.stringify(labels))
  await closeMenu()

  await openGeneral()
  await setField('select[aria-label="Search engine"]', 'duckduckgo', 'change')
  await sleep(300)
  await ev(`window.__mohoShots.store.setActivePanel('')`)
  await sleep(500)
  await ev(`getSelection().removeAllRanges()`)
  const row = await ev(`(() => { const r = document.querySelector('[data-msg-id]').getBoundingClientRect(); return { x: r.right - 20, y: r.top + r.height / 2 } })()`)
  await mouse('mouseMoved', row.x, row.y)
  await mouse('mousePressed', row.x, row.y, 'right')
  await mouse('mouseReleased', row.x, row.y, 'right')
  await sleep(400)
  labels = await menuLabels()
  check('without a selection there is no search entry', labels.length > 0 && !labels.some((l) => l.startsWith('Search ')), JSON.stringify(labels))
  await closeMenu()

} catch (e) {
  console.log('  FAIL', e.message)
  results.push(false)
} finally {
  await stop()
}
process.exit(results.every(Boolean) ? 0 : 1)
