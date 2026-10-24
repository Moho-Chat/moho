#!/usr/bin/env node
/**
 * A call between two moho windows on the local self-hosted Stoat: alice and bob each sign in, join the voice room with a
 * (fake) camera and microphone, and see each other - tiles, video arriving, who the daemon says is in the call - and
 * then one shares a screen.
 *
 *   node scripts/probe-stoat-voice.mjs <output directory>
 */
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, sleep } from './lib/harness.mjs'
import { accounts, API } from './lib/stoat-local.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const acc = accounts()
const FAKE = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
let crashed = false
const results = []
const check = (what, ok, detail = '') => {
  results.push(ok)
  console.log(ok ? '  ok  ' : '  FAIL', what, detail)
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

async function person(who) {
  const app = await launchApp({ env: { MOHO_UI_SHOTS: '1' }, args: FAKE })
  const ev = (code) => app.page.evaluate(code)
  const rpc = (method, params = {}) => ev(`window.moho.rpc(${JSON.stringify(method)}, ${JSON.stringify(params)})`)
  await sleep(2500)
  await app.page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await rpc('addStoatAccountToken', { instance: API, token: acc[who].token })
  const account = `stoat:${acc[who].id}`
  await until(async () => (await rpc('listAccounts')).find((a) => a.id === account && a.state === 'connected'))
  await ev(`window.__mohoShots.store.refreshAccounts(); window.__mohoShots.store.refreshBuffers()`)
  const room = `${account}|Test Hall/#Voice Room`
  await until(async () => (await rpc('listBuffers')).some((b) => b.id === room))
  await ev(`window.__mohoShots.store.refreshBuffers(); window.__mohoShots.store.selectBuffer(${JSON.stringify(room)})`)
  const shot = async (name) => {
    const { data } = await app.page.call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
  }
  return { ...app, ev, rpc, account, room, shot }
}

const apps = []
try {
  const a = await person('alice')
  apps.push(a)
  const b = await person('bob')
  apps.push(b)
  check('both are in the room', !!a.room && !!b.room)

  await a.ev(`window.__mohoShots.store.joinStoatCall(${JSON.stringify(a.room)}, true)`)
  const aUp = await until(async () => (await a.ev(`window.__mohoShots.state().activeCall?.phase`)) === 'connected')
  check('alice joins the voice room', !!aUp)
  await b.ev(`window.__mohoShots.store.joinStoatCall(${JSON.stringify(b.room)}, true)`)
  const bUp = await until(async () => (await b.ev(`window.__mohoShots.state().activeCall?.phase`)) === 'connected')
  check('bob joins it', !!bUp)

  const named = await until(async () => {
    const who = await a.ev(`(window.__mohoShots.state().stoatVoice[${JSON.stringify(a.room)}] ?? []).map((m) => m.name).sort().join(',')`)
    return who === 'alice,bob' ? who : null
  })
  check('the daemon says both are in the call', !!named)
  const tiles = await until(async () => {
    const t = await a.ev(`window.__mohoShots.store.callTiles().map((t) => ({ id: t.id, label: t.label, hasVideo: t.hasVideo }))`)
    return t.length === 2 && t.some((x) => x.label === 'bob') ? t : null
  })
  check('alice has a tile for bob', !!tiles, JSON.stringify(tiles))
  const arriving = await until(async () => {
    const r = await a.ev(`window.__mohoShots.store.callArrivals()`)
    return r.length > 0 && r.some((x) => x.packets > 0) ? r : null
  })
  check('and what bob sends arrives', !!arriving, JSON.stringify(arriving))
  const arrivingB = await until(async () => {
    const r = await b.ev(`window.__mohoShots.store.callArrivals()`)
    return r.some((x) => x.packets > 0) ? r : null
  })
  check('and what alice sends reaches bob', !!arrivingB)
  const video = await until(async () => (await a.ev(`window.__mohoShots.store.callTiles().find((t) => t.label === 'bob')?.hasVideo`)) === true)
  check('bob’s picture is video', !!video)
  await a.shot('stoat-call-alice.png')

  // The camera and the microphone, from the buttons' own methods.
  await a.ev(`window.__mohoShots.store.toggleCallMute()`)
  check('alice mutes', await until(async () => (await a.ev(`window.__mohoShots.state().activeCall?.muted`)) === true))
  const mutedForBob = await until(async () => (await b.ev(`(window.__mohoShots.state().stoatVoice[${JSON.stringify(b.room)}] ?? []).find((m) => m.name === 'alice')?.muted`)) === true)
  check('and the daemon tells bob she is muted', !!mutedForBob)
  await a.ev(`window.__mohoShots.store.toggleCamera()`)
  check('alice turns her camera off', await until(async () => (await a.ev(`window.__mohoShots.state().activeCall?.cameraOn`)) === false))
  const camOff = await until(async () => (await b.ev(`(window.__mohoShots.state().stoatVoice[${JSON.stringify(b.room)}] ?? []).find((m) => m.name === 'alice')?.camera`)) === false)
  check('and bob is told', !!camOff)

  // A screen.
  await a.ev(`window.__mohoShots.store.toggleScreenShare().catch(() => {})`)
  const sources = await until(async () => a.ev(`window.__mohoShots.state().screenSources`), 8000)
  if (sources?.length) await a.ev(`window.__mohoShots.store.chooseScreenSource(${JSON.stringify({ id: sources[0].id, name: sources[0].name })})`)
  const sharing = await until(async () => (await a.ev(`window.__mohoShots.state().activeCall?.sharingScreen`)) === true, 12000)
  check('alice shares a screen', !!sharing, sources ? `picked ${sources[0]?.name}` : 'no picker offered')
  if (sharing) {
    const told = await until(async () => (await b.ev(`(window.__mohoShots.state().stoatVoice[${JSON.stringify(b.room)}] ?? []).find((m) => m.name === 'alice')?.screen`)) === true)
    check('and bob is told it is a screen', !!told)
  }
  await b.shot('stoat-call-bob.png')

  await a.ev(`window.__mohoShots.store.hangUpMatrixCall()`)
  const left = await until(async () => (await b.ev(`(window.__mohoShots.state().stoatVoice[${JSON.stringify(b.room)}] ?? []).map((m) => m.name).join(',')`)) === 'bob')
  check('when alice hangs up, bob is alone in it', !!left)
  await b.ev(`window.__mohoShots.store.hangUpMatrixCall()`)

  // A call begun in a direct message rings the other person's window, who answers it.
  const dmA = (await a.rpc('openDirectMessage', { accountId: a.account, userId: acc.bob.id })).bufferId
  const dmB = (await b.rpc('openDirectMessage', { accountId: b.account, userId: acc.alice.id })).bufferId
  await a.ev(`window.__mohoShots.store.joinStoatCall(${JSON.stringify(dmA)}, false)`)
  const rung = await until(async () => (await b.ev(`window.__mohoShots.state().incomingCalls.some((c) => c.bufferId === ${JSON.stringify(dmB)} && c.ringing)`)) === true)
  check('a call alice begins in her direct message with bob rings bob’s window', !!rung)
  await b.shot('stoat-ring-bob.png')
  await b.ev(`window.__mohoShots.store.acceptCall(${JSON.stringify(dmB)})`)
  check('and bob answers it', !!(await until(async () => (await b.ev(`window.__mohoShots.state().activeCall?.phase`)) === 'connected')))
  check('and it stops ringing', (await b.ev(`window.__mohoShots.state().incomingCalls.some((c) => c.ringing)`)) === false)
  const together = await until(async () => (await a.ev(`(window.__mohoShots.state().stoatVoice[${JSON.stringify(dmA)}] ?? []).map((m) => m.name).sort().join(',')`)) === 'alice,bob')
  check('with both in it', !!together)
  await b.ev(`window.__mohoShots.store.hangUpMatrixCall()`)
  await a.ev(`window.__mohoShots.store.hangUpMatrixCall()`)
  // A ring declined stops, and the call carries on without them.
  await a.ev(`window.__mohoShots.store.joinStoatCall(${JSON.stringify(dmA)}, false)`)
  await until(async () => (await b.ev(`window.__mohoShots.state().incomingCalls.some((c) => c.ringing)`)) === true)
  await b.ev(`window.__mohoShots.store.declineCall(${JSON.stringify(dmB)})`)
  check('a ring turned down stops', (await b.ev(`window.__mohoShots.state().incomingCalls.some((c) => c.ringing)`)) === false)
  await a.ev(`window.__mohoShots.store.hangUpMatrixCall()`)
  const quiet = await until(async () => (await b.ev(`window.__mohoShots.state().incomingCalls.length`)) === 0)
  check('and nothing rings once the caller has gone', !!quiet)
} catch (e) {
  crashed = true
  console.log('CRASHED:', e.message)
} finally {
  for (const app of apps) await app.stop()
  console.log(results.every(Boolean) && !crashed ? 'ALL OK' : 'SOME FAILED')
  process.exitCode = results.every(Boolean) && !crashed ? 0 : 1
}
