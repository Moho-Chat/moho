#!/usr/bin/env node
/**
 * Reads a busy live Kick channel in a scratch moho and checks what replies and removals look like: that a
 * reply carries its thread, that the thread opens from it, and that a removed message is struck through in
 * red, left out or replaced by a notice according to Settings -> Kick. Removal is the one thing it cannot
 * wait for, so one is injected through the store the way the daemon's event would arrive.
 *
 *   node scripts/shot-kick-threads.mjs <output directory> [channel]
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { launchApp, sleep } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
const channel = process.argv[3] ?? 'xqc'
fs.mkdirSync(out, { recursive: true })
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const ev = (code) => page.evaluate(code)
const shot = async (name) => {
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
}
try {
  try {
    const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j']).toString())
    for (const c of clients.filter((c) => /electron|moho/i.test(c.class + c.title))) execFileSync('hyprctl', ['dispatch', 'movetoworkspacesilent', `2,address:${c.address}`])
  } catch {}
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  const rpc = (m, p) => ev(`window.moho.rpc(${JSON.stringify(m)}, ${JSON.stringify(p)}).catch((e) => ({ error: String(e.message || e) }))`)
  const added = await rpc('addKickAccount', {})
  say('join', JSON.stringify(await rpc('joinBuffer', { accountId: added.accountId, name: channel })))
  const id = `${added.accountId}|${channel}`
  await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(id)})`)

  // Replies, as the daemon read them: each should name the thread it belongs to.
  let replies = []
  for (let i = 0; i < 120 && replies.length < 2; i++) {
    await sleep(1000)
    replies = JSON.parse(await ev(`JSON.stringify((window.__mohoShots.state().messagesByBuffer[${JSON.stringify(id)}] || []).filter((m) => m.replyTo).map((m) => ({ id: m.id, to: m.replyTo.id, root: m.replyTo.threadRoot, thread: m.replyTo.thread })))`))
  }
  say('replies seen', replies.length, JSON.stringify(replies.slice(0, 4)))
  say('every reply has a thread root', replies.every((r) => r.root))
  await sleep(1500)
  await shot('kick-replies.png')

  await ev(`document.querySelector('.reply-preview')?.scrollIntoView({ block: 'center' })`)
  await sleep(500)
  await shot('kick-reply-row.png')
  // Open a thread from a reply.
  say('thread button', await ev(`(() => { const b = document.querySelector('.reply-thread-open'); if (!b) return false; b.click(); return true })()`))
  await sleep(1200)
  say('thread panel', await ev(`JSON.stringify({ open: !!document.querySelector('.thread-pane'), rows: document.querySelectorAll('.thread-pane .message-row').length, title: document.querySelector('.thread-header')?.textContent })`))
  await shot('kick-thread.png')
  await ev(`window.__mohoShots.store.closeThreadPanel()`)
  await sleep(300)

  // A removal, as the daemon would announce it, in each of the three ways.
  const victim = await ev(`(() => { const ms = window.__mohoShots.state().messagesByBuffer[${JSON.stringify(id)}] || []; const m = [...ms].reverse().find((x) => x.kind === 'chat' && x.body && !x.replyTo); return m && m.id })()`)
  await ev(`window.__mohoShots.store.handleEvent({ event: 'messageModerated', data: { bufferId: ${JSON.stringify(id)}, id: ${JSON.stringify(victim)}, moderated: { ai: true, rules: ['hate'] } } })`)
  await sleep(500)
  await ev(`document.querySelector('.message-row.removed')?.scrollIntoView({ block: 'center' })`)
  await sleep(500)
  say('removed row (default: strike)', await ev(`(() => { const r = document.querySelector('.message-row.removed .message-body'); if (!r) return null; const s = getComputedStyle(r); return JSON.stringify({ text: r.textContent.slice(0, 40), color: s.color, line: s.textDecorationLine, title: r.title }) })()`))
  await shot('kick-removed-strike.png')

  for (const [label, name] of [['Replace with notice', 'replace'], ['Delete', 'remove'], ['Strikethrough', 'strike']]) {
    await ev(`window.__mohoShots.store.setActivePanel('settings')`)
    await sleep(500)
    await ev(`[...document.querySelectorAll('.settings-rail-item, .settings-rail button')].find((b) => b.textContent.trim().startsWith('Kick'))?.click()`)
    await sleep(500)
    say('setting', label, await ev(`(() => { const b = [...document.querySelectorAll('.setting-segmented button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true })()`))
    await sleep(300)
    if (name === 'replace') await shot('kick-settings.png')
    await ev(`window.__mohoShots.store.setActivePanel('')`)
    await sleep(500)
    await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(id)})`)
    await sleep(700)
    say(name, await ev(`JSON.stringify({ removedRows: document.querySelectorAll('.message-row.removed').length, text: document.querySelector('.message-row.removed .message-body')?.textContent.slice(0, 50) })`))
    await ev(`document.querySelector('.message-row.removed')?.scrollIntoView({ block: 'center' })`)
    await sleep(300)
    if (name !== 'strike') await shot(`kick-removed-${name}.png`)
  }
} finally {
  await stop()
}
