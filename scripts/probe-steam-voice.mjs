#!/usr/bin/env node
/**
 * Steam voice against real Steam, through the real window: a scratch app signed in as
 * the throwaway account (never the real one) with a fake microphone makes a group with a
 * voice room, joins its voice, reports how it went, leaves, and leaves the group.
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
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
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
  const made = await rpc('steamChatGroupAction', { accountId: account, action: 'create', name: 'voice probe' })
  say('created', JSON.stringify(made))
  const group = String(made.groupId).split('steamgroup:')[1]
  say('room', JSON.stringify(await rpc('steamChatGroupAction', { accountId: account, action: 'createRoom', groupId: group, name: 'talk', voice: true })))
  let rooms = []
  for (let i = 0; i < 20 && !rooms.length; i++) {
    rooms = await rpc('steamVoiceRooms', { accountId: account, groupId: group })
    if (!rooms.length) await sleep(500)
  }
  say('voice rooms', JSON.stringify(rooms))
  const roomId = rooms[0]?.roomId
  await sleep(1500)
  await ev(`window.__mohoShots.store.joinSteamVoice(${JSON.stringify(account)}, ${JSON.stringify(group)}, ${JSON.stringify(roomId)})`)
  let phase = ''
  const seen = []
  for (let i = 0; i < 120; i++) {
    const now = await ev(`(() => { const s = window.__mohoShots.state(); return s.steamVoiceNow ? s.steamVoiceNow.phase : 'idle' })()`)
    if (now !== phase) { phase = now; seen.push(now); say('phase', now) }
    if (now === 'connected') break
    await sleep(500)
  }
  await sleep(4000)
  const report = await ev(`(async () => {
    const v = window.__mohoShots.store.steamVoiceLive
    const stats = []
    const rep = await v.pc.getStats()
    rep.forEach((s) => { if (['outbound-rtp', 'inbound-rtp', 'candidate-pair'].includes(s.type) && (s.type !== 'candidate-pair' || s.nominated)) stats.push({ type: s.type, kind: s.kind, packetsSent: s.packetsSent, bytesSent: s.bytesSent, packetsReceived: s.packetsReceived, rtt: s.currentRoundTripTime, state: s.state, ssrc: s.ssrc }) })
    return { phase: v.phase, level: v.level, rtt: v.rttMs, ice: v.pc.iceConnectionState, voiceChatId: v.voiceChatId, session: v.session, stats, mic: !!v.mic, sessions: window.__mohoShots.state().voiceSessions }
  })().catch((e) => ({ error: String(e) }))`)
  say('report', JSON.stringify(report, null, 1))
  say('rooms while in', JSON.stringify(await rpc('steamVoiceRooms', { accountId: account, groupId: group })))
  await ev(`window.__mohoShots.store.leaveVoice(${JSON.stringify(account)})`)
  await sleep(2000)
  say('rooms after leaving', JSON.stringify(await rpc('steamVoiceRooms', { accountId: account, groupId: group })))
  say('now', await ev(`JSON.stringify(window.__mohoShots.state().steamVoiceNow)`))
  say('left group', JSON.stringify(await rpc('leaveGroup', { groupId: made.groupId })))
} finally {
  await stop()
}
