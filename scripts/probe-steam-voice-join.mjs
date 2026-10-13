#!/usr/bin/env node
/**
 * Steam voice in a group that already exists, with somebody on the official client in the room too: a scratch app signed in as
 * the throwaway account (never the real one) with a fake microphone joins the group's voice room
 * and reports what it hears every ten seconds, until ~/.local/share/moho-dev/stop exists.
 *
 *   GROUP=78995476 ROOM=316282066 node scripts/probe-steam-voice-join.mjs
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
  const group = process.env.GROUP
  const roomId = process.env.ROOM
  const stopFile = path.join(os.homedir(), '.local/share/moho-dev/stop')
  for (let i = 0; i < 40; i++) {
    const rooms = await rpc('steamVoiceRooms', { accountId: account, groupId: group })
    if (Array.isArray(rooms) && rooms.length) break
    await sleep(500)
  }
  await ev(`window.__mohoShots.store.joinSteamVoice(${JSON.stringify(account)}, ${JSON.stringify(group)}, ${JSON.stringify(roomId)})`)
  let phase = ''
  let lastToast = ''
  for (let i = 0; i < 80; i++) {
    const now = await ev(`(() => { const s = window.__mohoShots.state(); return JSON.stringify({ phase: s.steamVoiceNow ? s.steamVoiceNow.phase : 'idle', toasts: s.toasts.map((t) => t.message || t.text || JSON.stringify(t)) }) })()`)
    if (now !== lastToast) { lastToast = now; say('fast', now) }
    await sleep(250)
  }
  for (let t = 0; t < 1200 && !fs.existsSync(stopFile); t += 10) {
    const now = await ev(`(() => { const s = window.__mohoShots.state(); return s.steamVoiceNow ? s.steamVoiceNow.phase : 'idle' })()`)
    if (now !== phase) { phase = now; say('phase', now) }
    const report = await ev(`(async () => {
      const v = window.__mohoShots.store.steamVoiceLive
      if (!v) return { none: true }
      const stats = []
      const rep = await v.pc.getStats()
      rep.forEach((s) => { if (['outbound-rtp', 'inbound-rtp', 'media-source', 'remote-inbound-rtp'].includes(s.type)) stats.push({ type: s.type, packetsSent: s.packetsSent, bytesSent: s.bytesSent, packetsReceived: s.packetsReceived, packetsLost: s.packetsLost, ssrc: s.ssrc, audioLevel: s.audioLevel, energy: s.totalAudioEnergy, rtt: s.roundTripTime }) })
      return { statuses: v.statuses ? [...v.statuses.entries()] : null, session: v.session, owners: v.owners ? [...v.owners.entries()] : null, track: v.mic ? v.mic.getAudioTracks().map((t) => [t.enabled, t.muted, t.readyState]) : null, phase: v.phase, rtt: v.rttMs, ice: v.pc.iceConnectionState, speakers: window.__mohoShots.state().steamVoiceNow?.speakers, stats }
    })().catch((e) => ({ error: String(e) }))`)
    say('report', JSON.stringify(report))
    say('toasts', await ev(`JSON.stringify(window.__mohoShots.state().toasts.map((t) => t.message || t.text || t))`))
    say('rooms', JSON.stringify(await rpc('steamVoiceRooms', { accountId: account, groupId: group })))
    await sleep(3000)
  }
  await ev(`window.__mohoShots.store.leaveVoice(${JSON.stringify(account)})`)
  await sleep(2000)
  say('left voice; the group is left in place')
} finally {
  await stop()
}
