#!/usr/bin/env node
/**
 * Calls between two real XMPP accounts on their public server, in two test windows of their own (each with its own daemon, a
 * fake camera and microphone), one account routed through moho's own Tor and the other not. The person signs both accounts in
 * themselves - this waits for them to - and everything after that is driven from here:
 *
 * - a voice call one way and a video call the other, answered, media flowing both ways, a camera turned on and off mid-call;
 * - what the Tor-routed side's browser offers as its addresses (a call's media does not go through Tor);
 * - a group call in a room (MUJI): one starts it, the other is rung and joins, media flows.
 *
 * The same accounts, if signed in to the person's own moho, are taken offline there for the length of the run (otherwise a call
 * rings there too) and brought back at the end. The windows are closed at the end, whatever happened.
 *
 *   node scripts/check-xmpp-call-live.mjs xmpp:tor-account@server xmpp:direct-account@server
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { launchApp, sleep } from './lib/harness.mjs'

const [ida, idb] = process.argv.slice(2)
if (!ida || !idb) throw new Error('usage: check-xmpp-call-live.mjs xmpp:tor-account@server xmpp:direct-account@server')
const [jida, jidb] = [ida.slice(5), idb.slice(5)]
const results = []
const check = (what, ok, detail = '') => {
  results.push(!!ok)
  console.log(ok ? '  ok  ' : '  FAIL', what, ok ? '' : String(detail).slice(0, 500))
}
const S = 'window.__mohoShots.store'
const until = async (app, expr, ms = 20000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    const v = await app.page.evaluate(expr).catch(() => null)
    if (v) return v
    await sleep(300)
  }
  return null
}
const rpc = (app, method, params = {}) => app.page.evaluate(`window.moho.rpc(${JSON.stringify(method)}, ${JSON.stringify(params)})`)
const flowing = (app, kind, group = false) =>
  app.page.evaluate(`(async () => {
    const calls = ${group} ? [...(${S}.matrixCalls.currentGroup?.peers?.values() ?? [])].map((p) => p.call) : [${S}.matrixCalls.current?.call].filter(Boolean)
    let packets = 0, frames = 0
    for (const call of calls) {
      const stats = await call.pc.getStats()
      stats.forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === ${JSON.stringify(kind)}) { packets += r.packetsReceived || 0; frames += r.framesDecoded || 0 } })
    }
    return calls.length ? { packets, frames } : null
  })()`)
/** The addresses a side's browser offered, and the pair the call settled on. */
const candidates = (app) =>
  app.page.evaluate(`(async () => {
    const call = ${S}.matrixCalls.current?.call
    if (!call) return null
    const stats = await call.pc.getStats()
    const local = [], pairs = []
    stats.forEach((r) => {
      if (r.type === 'local-candidate') local.push(r.candidateType + ' ' + (r.address ?? r.ip ?? '') + ' ' + r.protocol)
      if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pairs.push(r.localCandidateId + ' <-> ' + r.remoteCandidateId)
    })
    let chosen = null
    stats.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) { const p = stats.get(r.selectedCandidatePairId); const l = p && stats.get(p.localCandidateId); const m = p && stats.get(p.remoteCandidateId); chosen = l && m ? l.candidateType + ' ' + (l.address ?? '') + ' -> ' + m.candidateType + ' ' + (m.address ?? '') : null } })
    return { local: [...new Set(local)], chosen }
  })()`)

/** The person's own daemon: the accounts taken offline there for the run, and back at the end. */
const live = path.join(process.env.XDG_RUNTIME_DIR ?? '/run/user/1000', 'nobilis', 'nobilis.sock')
const liveRpc = (method, params) =>
  new Promise((resolve) => {
    if (!fs.existsSync(live)) return resolve(null)
    const c = net.connect(live)
    let buf = ''
    c.on('error', () => resolve(null))
    c.on('data', (d) => {
      buf += d
      for (const line of buf.split('\n').slice(0, -1)) {
        const m = JSON.parse(line)
        if (m.id === 1) {
          c.end()
          resolve(m.result ?? null)
        }
      }
      buf = buf.split('\n').pop()
    })
    c.on('connect', () => c.write(JSON.stringify({ id: 1, method, params }) + '\n'))
  })
const wasLive = []

/** Test windows go to workspace 2 (the person works on 1). */
function toWorkspace2(pids) {
  try {
    const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j']).toString())
    for (const c of clients) {
      let cmd = ''
      try {
        cmd = fs.readFileSync(`/proc/${c.pid}/cmdline`, 'utf8')
      } catch {}
      if (pids.includes(c.pid) || /node_modules\/electron/.test(cmd)) execFileSync('hyprctl', ['dispatch', `hl.dsp.window.move({ window = "address:${c.address}", workspace = "2", silent = true })`])
    }
  } catch {}
}

const apps = []
try {
  for (const id of [ida, idb]) {
    const a = ((await liveRpc('listAccounts', {})) ?? []).find((x) => x.id === id)
    if (a && a.state === 'connected') {
      await liveRpc('setAccountConnected', { accountId: id, connected: false })
      wasLive.push(id)
    }
  }
  console.log(`taken offline in your moho for the run: ${wasLive.join(', ') || 'nothing'}`)
  const fake = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  for (let i = 0; i < 2; i++) apps.push(await launchApp({ env: { MOHO_UI_SHOTS: '1' }, args: fake }))
  for (let i = 0; i < 10; i++) {
    toWorkspace2(apps.map((a) => a.pid).filter(Boolean))
    await sleep(500)
  }
  const [one, two] = apps
  console.log(`SIGN IN NOW (workspace 2): the first window ${jida} with "Route through Tor" on; the second ${jidb} with it off. Waiting up to 15 minutes.`)
  const signedIn = (app, id) => until(app, `${S}.state.accounts.some((x) => x.id === '${id}' && x.state === 'connected')`, 15 * 60000)
  const [okA, okB] = await Promise.all([signedIn(one, ida), signedIn(two, idb)])
  check(`${jida} signs in in the first window`, okA)
  check(`${jidb} signs in in the second window`, okB)
  if (!okA || !okB) throw new Error('not signed in')
  const routed = (await rpc(one, 'listAccounts')).find((x) => x.id === ida) ?? {}
  const direct = (await rpc(two, 'listAccounts')).find((x) => x.id === idb) ?? {}
  check('the first goes through Tor and the second does not', routed.useTor === true && direct.useTor === false, JSON.stringify({ routed, direct }).slice(0, 300))
  await rpc(one, 'xmppSetActive', { active: true })
  await rpc(two, 'xmppSetActive', { active: true })
  const bufferA = await until(one, `${S}.state.buffers.find((x) => x.accountId === '${ida}' && x.remoteId === '${jidb}')?.id`, 30000)
  const bufferB = await until(two, `${S}.state.buffers.find((x) => x.accountId === '${idb}' && x.remoteId === '${jida}')?.id`, 30000)
  check('each has the other as a contact', bufferA && bufferB, JSON.stringify({ bufferA, bufferB }))
  await sleep(3000)

  for (const [caller, callee, from, to, video, who] of [
    [one, two, bufferA, bufferB, false, 'a voice call from the Tor account'],
    [two, one, bufferB, bufferA, true, 'a video call to the Tor account']
  ]) {
    console.log(who)
    await caller.page.evaluate(`${S}.callMatrix(${JSON.stringify(from)}, ${video})`)
    const ring = await until(callee, `${S}.state.ringingCall`, 45000)
    check('it rings the other window, saying whether there is a camera', ring && ring.bufferId === to && ring.video === video, JSON.stringify(ring))
    if (!ring) continue
    await callee.page.evaluate(`${S}.answerMatrixCall(${video})`)
    for (const [app, side] of [[caller, 'the caller'], [callee, 'the one called']]) {
      check(`${side} is connected`, await until(app, `${S}.matrixCalls.current?.call?.pc?.connectionState === 'connected'`, 60000), await app.page.evaluate(`${S}.matrixCalls.current?.call?.pc?.connectionState + ' / ' + ${S}.matrixCalls.current?.call?.pc?.iceConnectionState`).catch(() => ''))
    }
    await sleep(3000)
    for (const [app, side] of [[caller, 'the caller'], [callee, 'the one called']]) {
      const audio = await flowing(app, 'audio')
      check(`${side} hears them`, audio && audio.packets > 20, JSON.stringify(audio))
      if (video) {
        const picture = await flowing(app, 'video')
        check(`${side} sees them`, picture && picture.frames > 5, JSON.stringify(picture))
      }
    }
    if (!video) {
      await caller.page.evaluate(`${S}.toggleCamera()`)
      await sleep(5000)
      const seenCam = await flowing(callee, 'video')
      check('a camera turned on during the call reaches the other end', seenCam && seenCam.frames > 5, JSON.stringify(seenCam))
      await caller.page.evaluate(`${S}.toggleCamera()`)
      await sleep(2500)
      check('turning it off leaves the call up', await until(caller, `${S}.matrixCalls.current?.call?.pc?.connectionState === 'connected'`, 5000))
    }
    const torSide = await candidates(one)
    console.log(`   the Tor account's browser offered: ${JSON.stringify(torSide?.local)}; the call settled on: ${torSide?.chosen}`)
    await caller.page.evaluate(`${S}.hangUpMatrixCall()`)
    check('hanging up ends it at both ends', (await until(callee, `!${S}.state.activeCall`, 20000)) && (await until(caller, `!${S}.state.activeCall`, 5000)))
    await sleep(1500)
  }

  console.log('a group call in a room')
  const service = `conference.${jida.split('@')[1]}`
  const room = `mohocall${Date.now().toString(36)}@${service}`
  await rpc(one, 'xmppJoinRoom', { accountId: ida, jid: room, nick: 'tor-side' })
  const roomA = await until(one, `${S}.state.buffers.find((x) => x.accountId === '${ida}' && x.remoteId === '${room}' && x.kind === 'channel')?.id`, 30000)
  await sleep(2000)
  await rpc(one, 'xmppSetRoomConfig', { bufferId: roomA, answers: { 'muc#roomconfig_whois': 'anyone', 'muc#roomconfig_membersonly': true } }).catch(() => {})
  await rpc(one, 'xmppRoomAction', { bufferId: roomA, action: 'member', jid: jidb }).catch(() => {})
  await rpc(two, 'xmppJoinRoom', { accountId: idb, jid: room, nick: 'direct-side' })
  const roomB = await until(two, `${S}.state.buffers.find((x) => x.accountId === '${idb}' && x.remoteId === '${room}' && x.kind === 'channel')?.id`, 30000)
  check('both are in the room', roomA && roomB)
  await sleep(3000)
  await one.page.evaluate(`${S}.joinMatrixGroupCall(${JSON.stringify(roomA)}, false)`)
  const rung = await until(two, `(${S}.state.callMembers[${JSON.stringify(roomB)}] ?? []).length > 0`, 45000)
  check('the other is rung: the room shows a call to join', rung)
  await two.page.evaluate(`${S}.joinMatrixGroupCall(${JSON.stringify(roomB)}, false)`)
  for (const [app, side] of [[one, 'the one who started it'], [two, 'the one who joined']]) {
    check(`${side} is connected to the other`, await until(app, `[...(${S}.matrixCalls.currentGroup?.peers?.values() ?? [])].some((p) => p.call.pc?.connectionState === 'connected')`, 60000), await app.page.evaluate(`JSON.stringify([...(${S}.matrixCalls.currentGroup?.peers?.values() ?? [])].map((p) => p.call.pc?.connectionState))`).catch(() => ''))
  }
  await sleep(3000)
  for (const [app, side] of [[one, 'the one who started it'], [two, 'the one who joined']]) {
    const audio = await flowing(app, 'audio', true)
    check(`${side} hears the other`, audio && audio.packets > 20, JSON.stringify(audio))
  }
  await two.page.evaluate(`${S}.matrixCalls.leaveGroup()`)
  await one.page.evaluate(`${S}.matrixCalls.leaveGroup()`)
  await sleep(1500)
  await rpc(one, 'xmppDestroyRoom', { bufferId: roomA, reason: 'moho test over' }).catch(() => {})
} catch (err) {
  console.log('  FAIL', err.message)
  results.push(false)
} finally {
  for (const app of apps) await app.stop().catch(() => {})
  for (const id of wasLive) await liveRpc('setAccountConnected', { accountId: id, connected: true })
  console.log(`brought back in your moho: ${wasLive.join(', ') || 'nothing'}`)
  console.log(results.every(Boolean) ? 'ALL OK' : 'SOME FAILED')
  process.exit(0)
}
