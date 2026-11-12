#!/usr/bin/env node
/**
 * An XMPP call between two real windows, each with its own daemon: the offer a browser writes goes through Jingle and is read by
 * another browser, and media crosses (a fake microphone and camera, no hardware). The claim that cannot be checked by reading is
 * that Chromium accepts what the SDP<->Jingle translation hands it - this is the check of that.
 *
 *   ~/.local/share/moho-dev/xmpp-test.sh up && npx electron-vite build && (cd nobilis && cargo build --release)
 *   node scripts/check-xmpp-call-windows.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp, sleep } from './lib/harness.mjs'

const ctl = (...a) => execFileSync(path.join(os.homedir(), '.local/share/moho-dev/xmpp-test.sh'), ['ctl', ...a]).toString()
const ca = fs.readFileSync('/1tb/xmpp-test/pki/ca.pem', 'utf8')
const stamp = Date.now().toString(36)
const a = { name: `ca${stamp}`, password: `pw-${stamp}-a`, jid: `ca${stamp}@localhost` }
const b = { name: `cb${stamp}`, password: `pw-${stamp}-b`, jid: `cb${stamp}@localhost` }
for (const p of [a, b]) ctl('register', p.name, 'localhost', p.password)
const results = []
const check = (what, ok, detail = '') => {
  results.push(!!ok)
  console.log(ok ? '  ok  ' : '  FAIL', what, ok ? '' : String(detail).slice(0, 400))
}
const fake = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
const apps = []
const open = async () => {
  const app = await launchApp({ env: { MOHO_UI_SHOTS: '1' }, args: fake })
  apps.push(app)
  return app
}
const S = 'window.__mohoShots.store'
const until = async (app, expr, ms = 20000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    const v = await app.page.evaluate(expr).catch(() => null)
    if (v) return v
    await sleep(250)
  }
  return null
}
/** What has crossed the connection, as the browser counts it. */
const flowing = (app, kind) =>
  app.page.evaluate(`(async () => {
    const call = ${S}.matrixCalls.current?.call
    if (!call) return null
    const stats = await call.pc.getStats()
    let packets = 0, frames = 0
    stats.forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === ${JSON.stringify(kind)}) { packets += r.packetsReceived || 0; frames += r.framesDecoded || 0 } })
    return { packets, frames }
  })()`)
const rpc = (app, method, params = {}) => app.page.evaluate(`window.moho.rpc(${JSON.stringify(method)}, ${JSON.stringify(params)})`)

try {
  const [one, two] = [await open(), await open()]
  const ida = `xmpp:${a.jid}`
  const idb = `xmpp:${b.jid}`
  await rpc(one, 'addXmppAccount', { jid: a.jid, password: a.password, host: '127.0.0.1', caPem: ca })
  await rpc(two, 'addXmppAccount', { jid: b.jid, password: b.password, host: '127.0.0.1', caPem: ca })
  for (const [app, id] of [[one, ida], [two, idb]]) {
    check(`${id} signs in`, await until(app, `${S}.state.accounts.some((x) => x.id === '${id}' && x.state === 'connected')`))
  }
  await rpc(one, 'xmppAddContact', { accountId: ida, jid: b.jid, name: 'Bea' })
  check('a request arrives', await until(two, `window.moho.rpc('xmppRequests', { accountId: '${idb}' }).then((r) => r.requests.length > 0)`))
  await rpc(two, 'xmppAnswerRequest', { accountId: idb, jid: a.jid, accept: true })
  const bufferA = await until(one, `${S}.state.buffers.find((x) => x.accountId === '${ida}' && x.remoteId === '${b.jid}')?.id`)
  const bufferB = await until(two, `${S}.state.buffers.find((x) => x.accountId === '${idb}' && x.remoteId === '${a.jid}')?.id`)
  check('they are contacts, with a conversation each', bufferA && bufferB, JSON.stringify({ bufferA, bufferB }))
  await one.page.evaluate(`${S}.selectBuffer(${JSON.stringify(bufferA)})`)
  await sleep(1500)
  check('the conversation offers a call', await one.page.evaluate(`[...document.querySelectorAll('button')].some((x) => x.title === 'Voice call' || x.getAttribute('aria-label') === 'Voice call')`))

  for (const video of [false, true]) {
    const what = video ? 'video' : 'voice'
    console.log(`a ${what} call`)
    await one.page.evaluate(`${S}.callMatrix(${JSON.stringify(bufferA)}, ${video})`)
    const ring = await until(two, `${S}.state.ringingCall`)
    check('it rings the other window, saying who and whether there is a camera', ring && ring.bufferId === bufferB && ring.video === video && ring.deferred === true, JSON.stringify(ring))
    await two.page.evaluate(`${S}.answerMatrixCall(${video})`)
    for (const [app, who] of [[one, 'the caller'], [two, 'the one called']]) {
      check(`${who} is connected`, await until(app, `${S}.matrixCalls.current?.call?.pc?.connectionState === 'connected'`, 30000), await app.page.evaluate(`${S}.matrixCalls.current?.call?.pc?.connectionState + ' / ' + ${S}.matrixCalls.current?.call?.pc?.iceConnectionState`).catch(() => ''))
    }
    await sleep(2500)
    for (const [app, who] of [[one, 'the caller'], [two, 'the one called']]) {
      const audio = await flowing(app, 'audio')
      check(`${who} hears them`, audio && audio.packets > 20, JSON.stringify(audio))
      if (video) {
        const picture = await flowing(app, 'video')
        check(`${who} sees them`, picture && picture.frames > 5, JSON.stringify(picture))
      }
    }
    if (!video) {
      // The camera turned on in a call already running: a section added to it, which Jingle carries as a content-add.
      await one.page.evaluate(`${S}.toggleCamera()`)
      await sleep(4000)
      const seen = await flowing(two, 'video')
      check('a camera turned on during the call reaches the other end (a content-add through Jingle)', seen && seen.frames > 5, JSON.stringify(seen))
      // And the other way, from the one who was called.
      await two.page.evaluate(`${S}.toggleCamera()`)
      await sleep(4000)
      const back = await flowing(one, 'video')
      check('and theirs reaches the caller', back && back.frames > 5, JSON.stringify(back))
      await one.page.evaluate(`${S}.toggleCamera()`)
      await sleep(2500)
      check('turning it off leaves the call up', await until(one, `${S}.matrixCalls.current?.call?.pc?.connectionState === 'connected'`, 5000))
    }
    // The one who called hangs up the voice call; the one who was called hangs up the video one.
    const [hanger, other] = video ? [two, one] : [one, two]
    await hanger.page.evaluate(`${S}.hangUpMatrixCall()`)
    check('hanging up ends it at both ends', await until(other, `!${S}.state.activeCall`, 15000) && await until(hanger, `!${S}.state.activeCall`, 5000))
    await sleep(1000)
  }
} catch (err) {
  console.log('  FAIL', err.message)
  results.push(false)
} finally {
  for (const app of apps) await app.stop()
  for (const p of [a, b]) {
    try {
      ctl('unregister', p.name, 'localhost')
    } catch {
      /* gone */
    }
  }
  console.log(results.every(Boolean) ? 'ALL OK' : 'SOME FAILED')
  process.exitCode = results.every(Boolean) ? 0 : 1
}
