#!/usr/bin/env node
/**
 * Calls between a moho driven from here (a window with its debugging port reachable, test hooks on, fake camera and microphone)
 * and a person answering in their own moho: real media on their side, and what reaches the driven side measured. Their moho
 * is asked only through its daemon's socket, to accept an invitation to the test room.
 *
 *   node scripts/check-xmpp-call-person.mjs <cdp port> xmpp:driven@server xmpp:person@server
 *
 * Rings them for a voice call (a camera turned on in the middle), then a video call, then starts a group call in a room made for
 * it that they join from the room's call bar. Each ring is repeated while unanswered, for up to three minutes.
 */
import net from 'node:net'
import path from 'node:path'

const [port, A, B] = process.argv.slice(2)
const [jidA, jidB] = [A.slice(5), B.slice(5)]
const S = 'window.__mohoShots.store'
const results = []
const check = (what, ok, detail = '') => {
  results.push(!!ok)
  console.log(ok ? '  ok  ' : '  FAIL', what, ok ? '' : String(detail).slice(0, 500))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)))
const waiting = new Map()
let nextId = 1
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data)
  if (msg.id && waiting.has(msg.id)) {
    waiting.get(msg.id)(msg)
    waiting.delete(msg.id)
  }
}
const evaluate = (expression) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    waiting.set(id, (msg) => (msg.result?.exceptionDetails ? reject(new Error(msg.result.exceptionDetails.exception?.description ?? 'error')) : resolve(msg.result?.result?.value)))
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
const until = async (expr, ms) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await evaluate(expr).catch(() => null)
    if (v) return v
    await sleep(500)
  }
  return null
}
const rpc = (method, params) => evaluate(`window.moho.rpc(${JSON.stringify(method)}, ${JSON.stringify(params)})`)
/** The person's own daemon. */
const personRpc = (method, params) =>
  new Promise((resolve) => {
    const c = net.connect(path.join(process.env.XDG_RUNTIME_DIR ?? '/run/user/1000', 'nobilis', 'nobilis.sock'))
    let buf = ''
    c.on('data', (d) => {
      buf += d
      for (const line of buf.split('\n').slice(0, -1)) {
        const m = JSON.parse(line)
        if (m.id === 1) {
          c.end()
          resolve(m.result ?? m.error)
        }
      }
      buf = buf.split('\n').pop()
    })
    c.on('connect', () => c.write(JSON.stringify({ id: 1, method, params }) + '\n'))
  })
const stats = (group) =>
  evaluate(`(async () => {
    const calls = ${group} ? [...(${S}.matrixCalls.currentGroup?.peers?.values() ?? [])].map((p) => p.call) : [${S}.matrixCalls.current?.call].filter(Boolean)
    const out = { audio: 0, frames: 0, sentAudio: 0, local: [], chosen: null }
    for (const call of calls) {
      const st = await call.pc.getStats()
      st.forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind === 'audio') out.audio += r.packetsReceived || 0
        if (r.type === 'inbound-rtp' && r.kind === 'video') out.frames += r.framesDecoded || 0
        if (r.type === 'outbound-rtp' && r.kind === 'audio') out.sentAudio += r.packetsSent || 0
        if (r.type === 'local-candidate') out.local.push(r.candidateType + ' ' + (r.address ?? '') + ' ' + r.protocol)
        if (r.type === 'transport' && r.selectedCandidatePairId) {
          const p = st.get(r.selectedCandidatePairId)
          const l = p && st.get(p.localCandidateId)
          const m = p && st.get(p.remoteCandidateId)
          if (l && m) out.chosen = l.candidateType + ' ' + (l.address ?? '') + ' -> ' + m.candidateType + ' ' + (m.address ?? '')
        }
      })
    }
    out.local = [...new Set(out.local)]
    return calls.length ? out : null
  })()`)

/** Rings until answered (each ring lasts a minute), for up to three minutes. */
async function ring(buffer, video) {
  const end = Date.now() + 180000
  while (Date.now() < end) {
    await evaluate(`${S}.callMatrix(${JSON.stringify(buffer)}, ${video})`)
    const answered = await until(`${S}.matrixCalls.current?.call?.pc?.connectionState === 'connected'`, 65000)
    if (answered) return true
    await evaluate(`${S}.hangUpMatrixCall()`).catch(() => {})
    await sleep(2000)
  }
  return false
}

try {
  await rpc('xmppSetActive', { active: true })
  const buffer = await until(`${S}.state.buffers.find((x) => x.accountId === '${A}' && x.remoteId === '${jidB}')?.id`, 20000)
  check('the driven side has the person as a contact', !!buffer)

  console.log('RINGING: a voice call - answer it')
  check('they answer the voice call and it connects', await ring(buffer, false))
  await sleep(5000)
  let st = await stats(false)
  check('their voice arrives here, and this side sends', st && st.audio > 50 && st.sentAudio > 50, JSON.stringify(st))
  console.log(`   this (Tor-routed) side offered: ${JSON.stringify(st?.local)}`)
  console.log(`   the call's media went: ${st?.chosen}`)
  await evaluate(`${S}.toggleCamera()`)
  console.log('   camera turned on here (a test picture) - you should see it now')
  await sleep(12000)
  check('the call stays up with a camera added', await evaluate(`${S}.matrixCalls.current?.call?.pc?.connectionState === 'connected'`))
  await evaluate(`${S}.hangUpMatrixCall()`)
  await sleep(4000)

  console.log('RINGING: a video call - answer it (with your camera if you have one)')
  check('they answer the video call and it connects', await ring(buffer, true))
  await sleep(8000)
  st = await stats(false)
  check('their audio arrives (and their picture, if they have a camera)', st && st.audio > 50, JSON.stringify(st))
  console.log(`   picture frames received here: ${st?.frames}`)
  await sleep(8000)
  await evaluate(`${S}.hangUpMatrixCall()`)
  await sleep(4000)

  console.log('a group call in a room')
  const room = `mohocall${Date.now().toString(36)}@conference.${jidA.split('@')[1]}`
  await rpc('xmppJoinRoom', { accountId: A, jid: room, nick: 'mohotester' })
  const roomA = await until(`${S}.state.buffers.find((x) => x.accountId === '${A}' && x.remoteId === '${room}' && x.kind === 'channel')?.id`, 30000)
  await sleep(2000)
  await rpc('xmppSetRoomConfig', { bufferId: roomA, answers: { 'muc#roomconfig_whois': 'anyone', 'muc#roomconfig_membersonly': true } }).catch(() => {})
  await rpc('xmppRoomAction', { bufferId: roomA, action: 'member', jid: jidB }).catch(() => {})
  await rpc('xmppInvite', { bufferId: roomA, jid: jidB })
  await sleep(4000)
  await personRpc('xmppAnswerInvite', { accountId: B, roomId: room, accept: true })
  await sleep(4000)
  await evaluate(`${S}.joinMatrixGroupCall(${JSON.stringify(roomA)}, false)`)
  console.log(`JOIN: in the room ${room}, press Join on the call bar`)
  const met = await until(`[...(${S}.matrixCalls.currentGroup?.peers?.values() ?? [])].some((p) => p.call.pc?.connectionState === 'connected')`, 180000)
  check('they join the group call and it connects', !!met)
  if (met) {
    await sleep(6000)
    const g = await stats(true)
    check('their voice arrives in the group call', g && g.audio > 50, JSON.stringify(g))
    await sleep(8000)
  }
  await evaluate(`${S}.matrixCalls.leaveGroup()`)
  await sleep(3000)
  await rpc('xmppDestroyRoom', { bufferId: roomA, reason: 'moho test over' }).catch(() => {})
} catch (err) {
  console.log('  FAIL', err.message)
  results.push(false)
} finally {
  await evaluate(`${S}.hangUpMatrixCall()`).catch(() => {})
  console.log(results.every(Boolean) ? 'ALL OK' : 'SOME FAILED')
  ws.close()
  process.exit(0)
}
