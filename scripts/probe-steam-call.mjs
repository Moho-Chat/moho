#!/usr/bin/env node
/**
 * A one-to-one Steam call with somebody on the official client: a scratch app signed in as
 * the throwaway account (never the real one) with a fake microphone joins the group's voice room
 * and reports what it hears every ten seconds, until ~/.local/share/moho-dev/stop exists.
 *
 *   MODE=call node scripts/probe-steam-call.mjs   (or MODE=wait, which answers the first ring)
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
  const mode = process.env.MODE || 'call'
  const stopFile = path.join(os.homedir(), '.local/share/moho-dev/stop')
  const state = (expr) => ev(`(() => { const s = window.__mohoShots.state(); return ${expr} })()`)
  if (mode === 'call') {
    let buffer = ''
    for (let i = 0; i < 60 && !buffer; i++) {
      buffer = await state(`(s.buffers.find((b) => b.accountId === ${JSON.stringify(account)} && b.kind === 'dm' && b.name === 'Salastil') || {}).id || ''`)
      if (!buffer) await sleep(1000)
    }
    say('calling', buffer)
    await ev(`window.__mohoShots.store.callBuffer(${JSON.stringify(buffer)})`)
  } else {
    say('waiting for a ring')
  }
  let answered = false
  let phase = ''
  for (let t = 0; t < 1200 && !fs.existsSync(stopFile); t += 3) {
    if (mode === 'wait' && !answered) {
      const ring = await state(`s.steamRings && s.steamRings.length ? JSON.stringify(s.steamRings[0]) : ''`)
      if (ring) {
        say('ringing', ring)
        await ev(`window.__mohoShots.store.answerSteamCall(window.__mohoShots.state().steamRings[0])`)
        answered = true
      }
    }
    const now = await state(`JSON.stringify({ phase: s.steamVoiceNow ? s.steamVoiceNow.phase : 'idle', toasts: s.toasts.map((t) => t.message || t.text || JSON.stringify(t)) })`)
    if (now !== phase) { phase = now; say('state', now) }
    const report = await ev(`(async () => {
      const v = window.__mohoShots.store.steamVoiceLive
      if (!v || !v.pc) return { none: true }
      const stats = []
      const rep = await v.pc.getStats()
      rep.forEach((s) => { if (['outbound-rtp', 'inbound-rtp', 'media-source'].includes(s.type)) stats.push({ type: s.type, packetsSent: s.packetsSent, packetsReceived: s.packetsReceived, audioLevel: s.audioLevel }) })
      return { phase: v.phase, rtt: v.rttMs, ice: v.pc.iceConnectionState, stats }
    })().catch((e) => ({ error: String(e) }))`)
    say('report', JSON.stringify(report))
    await sleep(3000)
  }
  await ev(`window.__mohoShots.store.leaveVoice(${JSON.stringify(account)})`)
  await sleep(2000)
  say('left the call')
} finally {
  await stop()
}
