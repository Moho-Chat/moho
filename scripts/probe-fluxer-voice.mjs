#!/usr/bin/env node
/**
 * Calls against the local self-hosted Fluxer: moho, signed in as mohoa, joins Test Hall's voice channel with a fake
 * microphone and camera, and mohob's own gateway session sees it there, sees its microphone go quiet, and sees it
 * leave. Then a direct message call: moho starting one rings mohob, and mohob starting one rings moho.
 *
 *   (the local stack running, LiveKit with FLUXER_LIVEKIT_USE_EXTERNAL_IP=false)
 *   npx electron-vite build && node scripts/probe-fluxer-voice.mjs <output directory>
 */
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, sleep } from './lib/harness.mjs'
import { accounts, as, session, ORIGIN } from './lib/fluxer-local.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const acc = accounts()
const FAKE = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
const bob = await session('mohob')
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' }, args: FAKE })
const ev = (code) => page.evaluate(code)
const rpc = (method, params = {}) => ev(`window.moho.rpc(${JSON.stringify(method)}, ${JSON.stringify(params)})`)
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
const lastState = (user, channel) => [...bob.events].reverse().find((e) => e.t === 'VOICE_STATE_UPDATE' && e.d.user_id === user && (channel === undefined || e.d.channel_id === channel))?.d
try {
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  const hall = (await as('mohob', 'GET', '/users/@me/guilds')).find((g) => g.name === 'Test Hall')
  const voiceChannel = (await as('mohob', 'GET', `/guilds/${hall.id}/channels`)).find((c) => c.type === 2)
  await rpc('addFluxerAccount', { instance: ORIGIN, login: 'mohoa', password: 'moho-test-pass-1' })
  const account = `fluxer:${acc.mohoa.user_id}`
  check('mohoa connects', !!(await until(async () => (await rpc('listAccounts')).find((a) => a.id === account && a.state === 'connected'), 60000)))
  await ev(`window.__mohoShots?.store.refreshAccounts?.(); window.__mohoShots?.store.refreshBuffers?.()`)
  const room = await until(async () => (await rpc('listBuffers')).find((b) => b.accountId === account && b.remoteId === voiceChannel.id))
  check('the voice channel is a conversation marked as one', room?.nameIcon === 'volume_up', JSON.stringify(room && [room.name, room.nameIcon]))

  await ev(`window.__mohoShots.store.selectBuffer?.(${JSON.stringify(room.id)})`)
  await ev(`window.__mohoShots.store.joinStoatCall(${JSON.stringify(room.id)}, true)`)
  const connected = await until(() => ev('window.__mohoShots.state().activeCall?.phase === "connected"'), 30000)
  check('moho joins the voice channel on LiveKit', !!connected, JSON.stringify(await ev('window.__mohoShots.state().activeCall')))
  const seen = await until(() => lastState(acc.mohoa.user_id, voiceChannel.id))
  check('mohob’s session sees mohoa in the channel, with the camera on', !!seen && seen.self_video === true, JSON.stringify(seen && [seen.channel_id, seen.self_mute, seen.self_video]))
  const listed = await until(async () => (await rpc('listStoatVoice', { accountId: account }))[room.id]?.some((m) => m.userId === acc.mohoa.user_id))
  check('and moho says who is in the call', !!listed)
  await ev('window.__mohoShots.store.toggleCallMute()')
  const quiet = await until(() => lastState(acc.mohoa.user_id, voiceChannel.id)?.self_mute === true)
  check('muting in moho is seen as muted', !!quiet)
  await page.call('Page.captureScreenshot', { format: 'png' }).then(({ data }) => fs.writeFileSync(path.join(out, 'fluxer-call.png'), Buffer.from(data, 'base64')))
  await ev('window.__mohoShots.store.hangUpMatrixCall()')
  const left = await until(() => [...bob.events].reverse().find((e) => e.t === 'VOICE_STATE_UPDATE' && e.d.user_id === acc.mohoa.user_id)?.d.channel_id === null)
  check('hanging up leaves the channel', !!left)

  // A direct message call, both ways.
  const dm = await as('mohob', 'POST', '/users/@me/channels', { recipient_id: acc.mohoa.user_id })
  const dmBuffer = await until(async () => {
    await rpc('openDirectMessage', { accountId: account, userId: acc.mohob.user_id }).catch(() => null)
    return (await rpc('listBuffers')).find((b) => b.accountId === account && b.remoteId === dm.id)
  })
  await ev(`window.__mohoShots.store.joinStoatCall(${JSON.stringify(dmBuffer.id)}, false)`)
  const rang = await until(() => [...bob.events].reverse().find((e) => (e.t === 'CALL_CREATE' || e.t === 'CALL_UPDATE') && e.d.channel_id === dm.id && e.d.ringing?.includes(acc.mohob.user_id)))
  check('calling mohob from moho rings him', !!rang)
  await ev('window.__mohoShots.store.hangUpMatrixCall()')
  await until(() => [...bob.events].reverse().find((e) => e.t === 'CALL_DELETE' && e.d.channel_id === dm.id), 15000)
  await sleep(1000)
  await ev(`window.__ringing = []; window.moho.onEvent((e) => { if (e.event === 'incomingCall') window.__ringing.push(e.data) })`)
  bob.send({ op: 4, d: { guild_id: null, channel_id: dm.id, self_mute: true, self_deaf: false, self_video: false, self_stream: false } })
  await sleep(1500)
  await as('mohob', 'POST', `/channels/${dm.id}/call/ring`, {}).catch((e) => console.log('ring:', e.message))
  const ringing = await until(() => ev(`window.__ringing.find((r) => r.ringing && r.bufferId === ${JSON.stringify(dmBuffer.id)})`))
  check('mohob calling rings moho', !!ringing, JSON.stringify(ringing))
  await rpc('declineStoatCall', { bufferId: dmBuffer.id })
  const stopped = await until(() => [...bob.events].reverse().find((e) => e.t === 'CALL_UPDATE' && e.d.channel_id === dm.id && !e.d.ringing?.includes(acc.mohoa.user_id)))
  check('and turning it down stops the ring', !!stopped)
  bob.send({ op: 4, d: { guild_id: null, channel_id: null } })
} catch (e) {
  console.log('probe stopped:', e.stack)
  results.push(false)
} finally {
  bob.close()
  await stop()
}
const failed = results.filter((r) => !r).length
console.log(failed ? `${failed} FAILED` : 'ALL OK')
process.exit(failed ? 1 : 0)
