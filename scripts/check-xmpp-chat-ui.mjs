#!/usr/bin/env node
/**
 * XMPP in the window with a real conversation: a contact added from the Join page, what the other person says and does
 * (a message, a reply, a reaction, a correction) drawn in the conversation, a room entered from the Join page with its
 * member list and its settings dialog.
 *
 *   ~/.local/share/moho-dev/xmpp-test.sh up && npx electron-vite build && (cd nobilis && cargo build --release)
 *   node scripts/check-xmpp-chat-ui.mjs <output directory>
 */
import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { launchApp, sleep, root } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const run = promisify(execFile)
const ctl = (...a) => execFileSync(path.join(os.homedir(), '.local/share/moho-dev/xmpp-test.sh'), ['ctl', ...a]).toString()
const ca = fs.readFileSync('/1tb/xmpp-test/pki/ca.pem', 'utf8')
const stamp = Date.now().toString(36)
const me = { name: `ua${stamp}`, password: `pw-${stamp}-a`, jid: `ua${stamp}@localhost` }
const you = { name: `ub${stamp}`, password: `pw-${stamp}-b`, jid: `ub${stamp}@localhost` }
for (const p of [me, you]) ctl('register', p.name, 'localhost', p.password)
const accountsFile = path.join(os.tmpdir(), `xmpp-ui-accounts-${stamp}.txt`)
fs.writeFileSync(accountsFile, [me, you].map((p) => `${p.jid} ${p.password}`).join('\n') + '\n', { mode: 0o600 })
const peer = async (steps) => JSON.parse((await run('/1tb/xmpp-test/venv/bin/python', [path.join(root, 'scripts/lib/xmpp-peer.py'), you.name, JSON.stringify(steps)], { env: { ...process.env, XMPP_TEST_ACCOUNTS: accountsFile }, maxBuffer: 1 << 24 })).stdout)

const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const ev = (code) => page.evaluate(code)
const rpc = (method, params = {}) => ev(`window.moho.rpc(${JSON.stringify(method)}, ${JSON.stringify(params)})`)
const shot = async (name) => {
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
}
const results = []
const check = (what, ok, detail = '') => {
  results.push(!!ok)
  console.log(ok ? '  ok  ' : '  FAIL', what, ok ? '' : String(detail).slice(0, 300))
}
const until = async (fn, ms = 15000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    const v = await ev(fn)
    if (v) return v
    await sleep(200)
  }
  return null
}
const text = () => ev(`document.body.innerText`)
const fill = (placeholder, value) =>
  ev(`(() => {
    const input = [...document.querySelectorAll('input')].find((i) => i.placeholder === ${JSON.stringify(placeholder)})
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
const click = (label) => ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)} && !x.disabled); if (!b) return false; b.click(); return true })()`)
try {
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1200, height: 820, deviceScaleFactor: 1, mobile: false })
  await rpc('addXmppAccount', { jid: me.jid, password: me.password, host: '127.0.0.1', caPem: ca })
  const id = `xmpp:${me.jid}`
  check('the account signs in', await until(`window.__mohoShots.store.state.accounts.some((a) => a.id === '${id}' && a.state === 'connected')`))

  await ev(`window.__mohoShots.store.setActivePanel('join', '${id}')`)
  await sleep(800)
  await fill('friend@example.org', you.jid)
  await fill('Name (optional)', 'Bea')
  await sleep(200)
  check('a contact is added from the Join page', await click('Add'))
  await peer([{ wait_for: 'subscribe', timeout: 8 }, { accept: me.jid }, { sleep: 1 }])
  check('and becomes a conversation in the list', await until(`window.__mohoShots.store.state.buffers.some((b) => b.accountId === '${id}' && b.name === 'Bea')`))
  const bufferId = await ev(`window.__mohoShots.store.state.buffers.find((b) => b.accountId === '${id}' && b.name === 'Bea').id`)
  await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(bufferId)})`)
  await sleep(800)
  await peer([
    { raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='u-1'><body>hello from the other side</body><origin-id xmlns='urn:xmpp:sid:0' id='u-1'/></message>` },
    { sleep: 0.5 },
    { raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat'><reactions xmlns='urn:xmpp:reactions:0' id='u-1'><reaction>🎉</reaction></reactions><store xmlns='urn:xmpp:hints'/></message>` },
    { sleep: 0.5 },
    { raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='u-2'><body>> Bea\n> hello from the other side\nyes indeed</body><origin-id xmlns='urn:xmpp:sid:0' id='u-2'/><reply xmlns='urn:xmpp:reply:0' id='u-1' to='${me.jid}'/><fallback xmlns='urn:xmpp:fallback:0' for='urn:xmpp:reply:0'><body start='0' end='34'/></fallback></message>` },
    { sleep: 1 }
  ])
  const shown = await until(`document.body.innerText.includes('hello from the other side')`)
  check('what they say is in the conversation', !!shown)
  const body = await text()
  check('a reply is drawn as one: the answer and what it answers, not the quoted fallback', body.includes('yes indeed') && !body.includes('> hello from the other side'), body.slice(-400))
  check('a reaction is on the message it names', body.includes('🎉'))
  await rpc('sendMessage', { bufferId, body: 'sent from the window' })
  check('what the account sends is there', !!(await until(`document.body.innerText.includes('sent from the window')`)))
  await shot('xmpp-chat.png')

  const room = `uiroom${stamp}@conference.localhost`
  await ev(`window.__mohoShots.store.setActivePanel('join', '${id}')`)
  await sleep(600)
  await fill('room@conference.example.org', room)
  await fill('Nickname', 'mohonick')
  await sleep(200)
  check('a room is joined from the Join page', await click('Join'))
  check('and is a conversation of its own, with who is in it', await until(`(() => { const b = window.__mohoShots.store.state.buffers.find((b) => b.accountId === '${id}' && b.kind === 'channel'); return !!b && (window.__mohoShots.store.state.presenceByBuffer[b.id] ?? []).some((m) => m.nick === 'mohonick') })()`, 20000))
  await sleep(1000)
  await shot('xmpp-room.png')
  // The conversation's own menu has the room's controls.
  await ev(`document.querySelector('.header-nameplate')?.click()`)
  await sleep(400)
  check('its menu offers the room\'s settings', !!(await ev(`!![...document.querySelectorAll('[role=menuitem], .context-menu *')].find((n) => n.textContent.trim() === 'Room settings…')`)))
  await ev(`[...document.querySelectorAll('[role=menuitem], .context-menu *')].find((n) => n.textContent.trim() === 'Room settings…')?.click()`)
  await sleep(800)
  check('which opens a dialog with the room\'s people, settings and invitations', await until(`document.body.innerText.includes('Invite & subject') && document.body.innerText.includes('Owners')`))
  await shot('xmpp-room-dialog.png')
} catch (err) {
  console.log('  FAIL', err.message)
  results.push(false)
} finally {
  await stop()
  for (const p of [me, you]) {
    try {
      ctl('unregister', p.name, 'localhost')
    } catch {
      /* gone */
    }
  }
  fs.rmSync(accountsFile, { force: true })
  console.log(results.every(Boolean) ? 'ALL OK' : 'SOME FAILED')
  process.exitCode = results.every(Boolean) ? 0 : 1
}
