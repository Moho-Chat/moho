#!/usr/bin/env node
/**
 * Reads a busy live Kick channel in a scratch moho and reports how the chatters count grows against the
 * names listed, and whether drawing a long list holds the window up.
 *
 *   node scripts/watch-kick-roster.mjs [channel] [seconds]
 */
import { execFileSync } from 'node:child_process'
import { launchApp, sleep } from './lib/harness.mjs'

const channel = process.argv[2] ?? 'spreen'
const seconds = Number(process.argv[3] ?? 150)
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const ev = (code) => page.evaluate(code)
try {
  try {
    const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j']).toString())
    for (const c of clients.filter((c) => /electron|moho/i.test(c.class + c.title))) execFileSync('hyprctl', ['dispatch', 'movetoworkspacesilent', `2,address:${c.address}`])
  } catch {}
  await sleep(2500)
  const rpc = (m, p) => ev(`window.moho.rpc(${JSON.stringify(m)}, ${JSON.stringify(p)}).catch((e) => ({ error: String(e.message || e) }))`)
  const added = await rpc('addKickAccount', {})
  await rpc('joinBuffer', { accountId: added.accountId, name: channel })
  const id = `${added.accountId}|${channel}`
  await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(id)})`)
  await ev(`(() => { window.__long = 0; window.__longMs = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__long++; window.__longMs += e.duration } }).observe({ entryTypes: ['longtask'] }) })()`)
  const began = Date.now()
  while (Date.now() - began < seconds * 1000) {
    await sleep(15000)
    console.log(await ev(`JSON.stringify({ header: document.querySelector('.nicklist-header span')?.textContent, rows: document.querySelectorAll('.nicklist .member-row, .nicklist-scroll > div > div:not(.nicklist-group)').length, state: (() => { const s = window.__mohoShots.state(); return { listed: (s.presenceByBuffer[${JSON.stringify(id)}] || []).length, total: s.presenceTotalByBuffer[${JSON.stringify(id)}] } })(), longTasks: window.__long, longMs: Math.round(window.__longMs) })`))
  }
} finally {
  await stop()
}
