#!/usr/bin/env node
/**
 * A Mattermost call between two moho windows against the local server (the Calls plugin on it): mohoa calls mohob in
 * their direct message, mohob's window rings and joins, and each window hears the other's fake microphone; the server
 * sees mute and a raised hand; the call bar is pictured; both hang up and the call ends.
 *
 *   npx electron-vite build && node scripts/probe-mattermost-call.mjs <output directory>
 */
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, sleep } from './lib/harness.mjs'
import { as, SERVER, PASSWORDS } from './lib/mattermost-local.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const FAKE = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
const results = []
const check = (what, ok, detail = '') => {
  results.push(ok)
  console.log(ok ? '  ok  ' : '  FAIL', what, ok ? '' : detail)
}
const until = async (fn, ms = 20000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    try {
      const v = await fn()
      if (v) return v
    } catch {
      /* not yet */
    }
    await sleep(300)
  }
  return null
}

/** One window, signed in as `who`, open on its direct message with the other. */
async function window_(who) {
  const app = await launchApp({ env: { MOHO_UI_SHOTS: '1' }, args: FAKE })
  const ev = (code) => app.page.evaluate(code)
  const rpc = (method, params = {}) => ev(`window.moho.rpc(${JSON.stringify(method)}, ${JSON.stringify(params)})`)
  await sleep(2500)
  await app.page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await rpc('addMattermostAccount', { server: SERVER, login: who, password: PASSWORDS[who] })
  const account = await until(async () => (await rpc('listAccounts')).find((a) => a.service === 'mattermost' && a.state === 'connected'), 60000)
  await ev(`window.__mohoShots?.store.refreshAccounts?.(); window.__mohoShots?.store.refreshBuffers?.()`)
  await ev(`window.__ringing = []; window.moho.onEvent((e) => { if (e.event === 'incomingCall') window.__ringing.push(e.data) })`)
  return { ...app, ev, rpc, account }
}

const a = await window_('mohoa')
const b = await window_('mohob')
try {
  check('both sign in', !!a.account && !!b.account)
  const me = await as('mohoa', 'GET', '/users/me')
  const bee = await as('mohob', 'GET', '/users/me')
  const dm = await as('mohob', 'POST', '/channels/direct', [bee.id, me.id])
  const find = (w) => until(async () => (await w.rpc('listBuffers')).find((x) => x.accountId === w.account.id && x.remoteId === dm.id))
  const [da, db] = [await find(a), await find(b)]
  await a.ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(da.id)})`)
  await a.ev(`window.__mohoShots.store.callBuffer(${JSON.stringify(da.id)})`)
  check('mohoa is in the call', !!(await until(() => a.ev('window.__mohoShots.state().activeCall?.phase === "connected"'), 30000)), JSON.stringify(await a.ev('window.__mohoShots.state().toasts')))
  const rang = await until(() => b.ev(`window.__ringing.find((r) => r.ringing && r.bufferId === ${JSON.stringify(db.id)})`))
  check('mohob’s window rings', !!rang)
  await b.ev(`window.__mohoShots.store.acceptCall(${JSON.stringify(db.id)})`)
  check('mohob is in the call', !!(await until(() => b.ev('window.__mohoShots.state().activeCall?.phase === "connected"'), 30000)))
  const state = await until(async () => {
    const calls = await as('mohob', 'GET', '/../../plugins/com.mattermost.calls/channels').catch(() => null)
    const call = calls?.find?.((c) => c.channel_id === dm.id)?.call
    return call?.sessions?.length === 2 ? call : null
  })
  check('the server has both in the call', !!state, JSON.stringify(state))
  const hearing = async (w) => until(async () => ((await w.ev('window.__mohoShots.store.callArrivals?.()')) ?? []).some((x) => x.packets > 20), 20000)
  check('mohoa hears mohob', !!(await hearing(a)), JSON.stringify(await a.ev('window.__mohoShots.store.callArrivals?.()')))
  check('mohob hears mohoa', !!(await hearing(b)), JSON.stringify(await b.ev('window.__mohoShots.store.callArrivals?.()')))
  const members = await until(async () => (await a.rpc('listStoatVoice', { accountId: a.account.id }))[da.id]?.length === 2)
  check('moho lists both in the call', !!members)
  const { data } = await a.page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, 'mattermost-call.png'), Buffer.from(data, 'base64'))
  // Mute: the window joins muted or not as its voice buttons say; toggled here and seen by the other window.
  const before = await a.ev('window.__mohoShots.state().activeCall?.muted')
  await a.ev('window.__mohoShots.store.toggleCallMute()')
  const seenMute = await until(async () => {
    const list = (await b.rpc('listStoatVoice', { accountId: b.account.id }))[db.id] ?? []
    return list.find((m) => m.userId === me.id && m.muted === !before)
  })
  check('a mute is seen by the other side', !!seenMute)
  await a.rpc('mattermost', { action: 'callHand', bufferId: da.id, raised: true })
  const hand = await until(async () => ((await b.rpc('listStoatVoice', { accountId: b.account.id }))[db.id] ?? []).find((m) => m.userId === me.id && m.raisedHand))
  check('a raised hand is seen by the other side', !!hand)
  await a.ev('window.__mohoShots.store.hangUpMatrixCall()')
  await b.ev('window.__mohoShots.store.hangUpMatrixCall()')
  const ended = await until(async () => {
    const calls = await as('mohob', 'GET', '/../../plugins/com.mattermost.calls/channels').catch(() => null)
    return Array.isArray(calls) && !calls.some((c) => c.channel_id === dm.id && c.call)
  }, 30000)
  check('hanging up ends the call', !!ended)
} catch (e) {
  console.log('probe stopped:', e.stack)
  results.push(false)
} finally {
  await a.stop()
  await b.stop()
}
const failed = results.filter((r) => !r).length
console.log(failed ? `${failed} FAILED` : 'ALL OK')
process.exit(failed ? 1 : 0)
