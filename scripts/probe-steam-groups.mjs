#!/usr/bin/env node
/**
 * The groups Steam says an account is in, after a fresh sign-in: a scratch app signed in as
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
  await sleep(5000)
  say('window groups', await ev(`JSON.stringify(window.__mohoShots.state().groups.filter((g) => g.accountId === ${JSON.stringify(account)}).map((g) => g.name))`))
  say('daemon groups', JSON.stringify(((await rpc('steamChatGroups', { accountId: account })) ?? []).map((g) => g.name)))
  say('steam channels', await ev(`JSON.stringify(window.__mohoShots.state().buffers.filter((b) => b.accountId === ${JSON.stringify(account)} && b.kind === 'channel').map((b) => b.name))`))
} finally {
  await stop()
}
