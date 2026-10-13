#!/usr/bin/env node
/**
 * Leaving a Steam group through the window, the way a person does: a scratch app signed in as
 * the throwaway account (never the real one) with a fake microphone joins the group's voice room
 * and reports what it hears every ten seconds, until ~/.local/share/moho-dev/stop exists.
 *
 *   NAME='Biggest Newest Moho Test' WAY=rail node scripts/probe-steam-leave.mjs   (WAY=rail or settings)
 *
 *   npx electron-vite build && node scripts/probe-steam-voice.mjs
 *
 * Needs the throwaway account's block in ~/.config/nobilis/accounts.toml. The app is the
 * one built in out/, with its own home and runtime directory, and signs the account in
 * for as long as this runs - so nothing else may be signed in as it.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { launchApp, sleep } from './lib/harness.mjs'

const live = fs.readFileSync(path.join(os.homedir(), '.config/nobilis/accounts.toml'), 'utf8')
const block = live.split(/\n(?=\[)/).find((b) => b.startsWith('[[steam_account]]') && /username\s*=\s*"mohotester"/.test(b))
if (!block) throw new Error('the throwaway account is not in accounts.toml')

const { page, stop, scratch } = await launchApp({
  env: { MOHO_UI_SHOTS: '1' },
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${os.homedir()}/.local/share/moho-dev/speech.wav`],
  seed: (home) => {
    fs.mkdirSync(path.join(home, 'config/nobilis'), { recursive: true })
    fs.writeFileSync(path.join(home, 'config/nobilis/accounts.toml'), block + '\n')
  }
})
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const ev = (code) => page.evaluate(code)
try {
  // The window onto workspace 2, where the user does not look.
  try {
    const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j']).toString())
    for (const c of clients.filter((c) => /electron|moho/i.test(c.class + c.title))) execFileSync('hyprctl', ['dispatch', 'movetoworkspacesilent', `2,address:${c.address}`])
  } catch {}
  let account = ''
  for (let i = 0; i < 90 && !account; i++) {
    account = await ev(`(() => { const a = window.__mohoShots.state().accounts.find((a) => a.id.startsWith('steam:') && a.state === 'connected'); return a ? a.id : '' })()`)
    if (!account) await sleep(1000)
  }
  say('account', account || 'NOT CONNECTED')
  if (!account) throw new Error('not connected')
  const rpc = (m, p) => page.evaluate(`window.moho.rpc(${JSON.stringify(m)}, ${JSON.stringify(p)}).catch((e) => ({ error: String(e.message || e) }))`)
  page.on('console', (m) => say('console', m.type(), m.text().slice(0, 300)))
  const name = process.env.NAME ?? ''
  const way = process.env.WAY ?? 'rail'
  const state = (expr) => ev(`(() => { const s = window.__mohoShots.state(); return ${expr} })()`)
  if (process.env.CREATE) say('created', JSON.stringify(await rpc('steamChatGroupAction', { accountId: account, action: 'create', name })))
  let group = null
  for (let i = 0; i < 60 && !group; i++) {
    group = await state(`(s.groups.find((g) => g.accountId === ${JSON.stringify(account)} && g.name === ${JSON.stringify(name)}) || null)`)
    if (!group) await sleep(1000)
  }
  say('group', JSON.stringify(group))
  if (process.env.VOICE && group) {
    // In the group's voice room when it is left.
    const number = group.id.split('steamgroup:')[1]
    say('voice room', JSON.stringify(await rpc('steamChatGroupAction', { accountId: account, action: 'createRoom', groupId: number, name: 'talk', voice: true })))
    let rooms = []
    for (let i = 0; i < 20 && !rooms.length; i++) {
      rooms = await rpc('steamVoiceRooms', { accountId: account, groupId: number })
      if (!rooms.length) await sleep(500)
    }
    await ev(`window.__mohoShots.store.joinSteamVoice(${JSON.stringify(account)}, ${JSON.stringify(number)}, ${JSON.stringify(rooms[0].roomId)})`)
    for (let i = 0; i < 30; i++) {
      if ((await state(`s.steamVoiceNow ? s.steamVoiceNow.phase : 'idle'`)) === 'connected') break
      await sleep(500)
    }
    say('in voice', await state(`s.steamVoiceNow ? s.steamVoiceNow.phase : 'idle'`))
    await sleep(3000)
  }
  if (!group) throw new Error('the group is not in the window')
  await sleep(1500)
  const click = (text) => ev(`(() => { const e = [...document.querySelectorAll('button, [role=menuitem]')].find((b) => b.textContent.trim().endsWith(${JSON.stringify(text)})); if (!e) return false; e.click(); return true })()`)
  if (way === 'room') {
    // A room's own menu: what it offers is leaving the group.
    await ev(`window.__mohoShots.store.selectGroup(${JSON.stringify(group.id)})`)
    let room = null
    for (let i = 0; i < 30 && !room; i++) {
      room = await state(`(s.buffers.find((b) => b.groupId === ${JSON.stringify(group.id)} && b.kind === 'channel') || null)`)
      if (!room) await sleep(500)
    }
    say('room', JSON.stringify(room && room.name))
    await sleep(800)
    say('menu opened', await ev(`(() => { const row = [...document.querySelectorAll('.buffer-row')][0]; if (!row) return false; const r = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.x + 20, clientY: r.y + 10 })); return true })()`))
    await sleep(400)
    say('menu', JSON.stringify(await ev(`[...document.querySelectorAll('.context-menu button, .context-menu [role=menuitem]')].map((e) => e.textContent.trim())`)))
    say('clicked', await click('Leave group…'))
  } else if (way === 'rail') {
    say('menu opened', await ev(`(() => { const tile = [...document.querySelectorAll('.rail-tile')].find((t) => t.getAttribute('aria-label') === ${JSON.stringify(name)}); if (!tile) return false; const r = tile.getBoundingClientRect(); tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.x + 10, clientY: r.y + 10 })); return true })()`))
    await sleep(400)
    say('menu', JSON.stringify(await ev(`[...document.querySelectorAll('.context-menu button, .context-menu [role=menuitem]')].map((e) => e.textContent.trim())`)))
    say('clicked Leave server', await click('Leave server'))
  } else {
    say('menu opened', await ev(`(() => { const tile = [...document.querySelectorAll('.rail-tile')].find((t) => t.getAttribute('aria-label') === ${JSON.stringify(name)}); if (!tile) return false; const r = tile.getBoundingClientRect(); tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.x + 10, clientY: r.y + 10 })); return true })()`))
    await sleep(400)
    say('clicked Group settings', await click('Group settings'))
    await sleep(800)
    say('clicked Leave group', await click('Leave group'))
  }
  await sleep(600)
  say('buttons now', JSON.stringify(await ev(`[...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /leave/i.test(t))`)))
  // The confirmation counts down before it will leave ("Leave in 10"): waited out, as a person has to.
  for (let i = 0; i < 40; i++) {
    if (await ev(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Leave' && !b.disabled)`)) break
    await sleep(500)
  }
  // The dialog's own Leave (or the inline confirm's).
  say('confirmed', await ev(`(() => { const all = [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Leave'); const e = all[all.length - 1]; if (!e) return false; e.click(); return true })()`))
  for (let i = 0; i < 30; i++) {
    const still = await state(`s.groups.some((g) => g.id === ${JSON.stringify(group.id)})`)
    if (!still) break
    await sleep(500)
  }
  say('still in the window', await state(`s.groups.some((g) => g.id === ${JSON.stringify(group.id)})`))
  say('toasts', await state(`JSON.stringify(s.toasts.map((t) => t.message || t.text || JSON.stringify(t)))`))
  say('voice after', await state(`s.steamVoiceNow ? s.steamVoiceNow.phase : 'idle'`))
  const held = await rpc('steamChatGroups', { accountId: account })
  say('daemon still holds', JSON.stringify((held ?? []).map((g) => g.name)))
} finally {
  await stop()
}
