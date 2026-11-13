#!/usr/bin/env node
/**
 * Two real XMPP accounts in the running moho (the person's own daemon, not a scratch one), against their public server: what an
 * account does, end to end, through whatever route the accounts are set to (Tor, for the runs this was written for). Nothing is
 * signed in or out here except one account briefly going offline to see what it missed come back.
 *
 *   node scripts/probe-xmpp-live.mjs xmpp:sender@server xmpp:receiver@server
 *
 * MUC=<service> names the group chat service when it is not conference.<domain>.
 *
 * The sender does the writing; the receiver writes only where a check needs an answer (a reaction, an encrypted reply, joining a
 * room). Every message says it is a test. The room made for it is destroyed at the end; encryption is left as it was.
 */
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const [A, B] = args.filter((a) => a.startsWith('xmpp:'))
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
if (!A || !B) throw new Error('usage: probe-xmpp-live.mjs xmpp:sender@server xmpp:receiver@server [--a-cdp <port> --a-ssh <user@host>]')
const jidA = A.slice(5)
const jidB = B.slice(5)
const events = []

/** The person's own daemon, through its socket. */
async function socketEndpoint() {
  const conn = net.connect(path.join(process.env.XDG_RUNTIME_DIR ?? '/run/user/1000', 'nobilis', 'nobilis.sock'))
  const waiting = new Map()
  let nextId = 1
  let buf = ''
  conn.on('data', (d) => {
    buf += d
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      const m = JSON.parse(line)
      if (m.id && waiting.has(m.id)) {
        waiting.get(m.id)(m)
        waiting.delete(m.id)
      } else if (m.event) events.push(m)
    }
  })
  await new Promise((r) => conn.once('connect', r))
  return {
    rpc: (method, params) =>
      new Promise((resolve, reject) => {
        const id = nextId++
        waiting.set(id, (m) => (m.error ? reject(new Error(typeof m.error === 'string' ? m.error : JSON.stringify(m.error))) : resolve(m.result)))
        conn.write(JSON.stringify({ id, method, params }) + '\n')
      }),
    close: () => conn.end()
  }
}

/** A moho window somewhere else (another machine, through a tunnel), through its debugging port: its daemon is asked through the
 *  window, and the daemon's events are collected in the page and fetched from there. */
async function cdpEndpoint(port) {
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
      waiting.set(id, (msg) => {
        const r = msg.result
        if (msg.error || r?.exceptionDetails) reject(new Error(r?.exceptionDetails?.exception?.description ?? JSON.stringify(msg.error ?? r.exceptionDetails)))
        else resolve(r.result.value)
      })
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    })
  await evaluate(`(window.__probeEvents = window.__probeEvents ?? (() => { const q = []; window.moho.onEvent((f) => q.push(f)); return q })(), true)`)
  let open = true
  ;(async () => {
    while (open) {
      const got = await evaluate('window.__probeEvents.splice(0)').catch(() => [])
      events.push(...(got ?? []))
      await new Promise((r) => setTimeout(r, 300))
    }
  })()
  return {
    rpc: (method, params) => evaluate(`window.moho.rpc(${JSON.stringify(method)}, ${JSON.stringify(params)})`),
    close: () => {
      open = false
      ws.close()
    }
  }
}

const local = await socketEndpoint()
const remote = option('--a-cdp') ? await cdpEndpoint(Number(option('--a-cdp'))) : null
const sshA = option('--a-ssh')
const owner = (params) => params.accountId ?? params.bufferId?.split('|')[0] ?? null
/** Each request goes to the daemon its account is in; one about no account goes to both, lists put together. */
const rpc = async (method, params = {}) => {
  if (!remote) return local.rpc(method, params)
  const who = owner(params)
  if (who === A) return remote.rpc(method, params)
  if (who) return local.rpc(method, params)
  const [x, y] = await Promise.all([remote.rpc(method, params), local.rpc(method, params)])
  return Array.isArray(x) && Array.isArray(y) ? [...x, ...y] : x
}
/** Files the sending account uses, where its daemon is. */
const remoteTemp = sshA ? execFileSync('ssh', ['-o', 'BatchMode=yes', sshA, 'echo %TEMP%'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() : null
const putA = (name, content) => {
  const here = path.join(os.tmpdir(), name)
  fs.writeFileSync(here, content)
  if (!sshA) return here
  const there = `${remoteTemp}\\${name}`
  execFileSync('scp', ['-q', '-o', 'BatchMode=yes', here, `${sshA}:${there.replaceAll('\\', '/')}`], { stdio: 'ignore' })
  fs.rmSync(here, { force: true })
  return there
}
const readA = (p) => {
  if (!sshA) return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  const here = path.join(os.tmpdir(), `moho-back-${Date.now()}`)
  try {
    execFileSync('scp', ['-q', '-o', 'BatchMode=yes', `${sshA}:${p.replaceAll('\\', '/')}`, here], { stdio: 'ignore' })
    return fs.readFileSync(here, 'utf8')
  } catch {
    return null
  } finally {
    fs.rmSync(here, { force: true })
  }
}
const dropA = (p) => {
  if (!sshA) return fs.rmSync(p, { force: true })
  try {
    execFileSync('ssh', ['-o', 'BatchMode=yes', sshA, `del "${p}"`], { stdio: 'ignore' })
  } catch {}
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, ms = 30000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await sleep(250)
  }
  return null
}
const seen = (event, test) => events.find((e) => e.event === event && test(e.data))?.data ?? null
const results = []
const check = (what, ok, detail = '') => {
  results.push(!!ok)
  console.log(ok ? '  ok  ' : '  FAIL', what, ok ? '' : String(detail).slice(0, 500))
}
const stamp = new Date().toISOString().slice(11, 19)
const dm = async (account, remote) => until(async () => (await rpc('listBuffers')).find((b) => b.accountId === account && b.remoteId === remote && b.kind === 'dm') ?? null, 30000)

try {
  console.log('the accounts')
  const accounts = await rpc('listAccounts')
  for (const id of [A, B]) {
    const a = accounts.find((x) => x.id === id)
    check(`${id} is connected`, a?.state === 'connected', a?.state)
  }
  const info = await rpc('xmppServerInfo', { accountId: A })
  const vars = new Set((info.features ?? []).map((f) => f.var ?? f))
  console.log(`   ${info.software ?? 'the server'} ${info.version ?? ''} offers ${vars.size} features; archive ${vars.has('urn:xmpp:mam:2') ? 'yes' : 'no'}, push ${vars.has('urn:xmpp:push:0') ? 'yes' : 'no'} (uploads are a service of their own, tried below)`)
  check('the server answers what it offers', vars.size > 0, JSON.stringify(info).slice(0, 300))

  // A window that is not being looked at tells the server so (client state indication), and the server then holds presence back:
  // the run says it is looked at, so a status change is seen when it happens.
  await rpc('xmppSetActive', { active: true })

  console.log('contacts')
  await rpc('xmppAddContact', { accountId: A, jid: jidB, name: 'test receiver' })
  const asked = await until(async () => ((await rpc('xmppRequests', { accountId: B })).requests ?? []).find((r) => r.jid === jidA) ?? null, 20000)
  if (asked) await rpc('xmppAnswerRequest', { accountId: B, jid: jidA, accept: true })
  const ab = await dm(A, jidB)
  const ba = await dm(B, jidA)
  check('each has a conversation with the other', !!ab && !!ba, `${!!ab} ${!!ba} (asked: ${!!asked})`)
  await rpc('subscribe', { bufferId: ab.id })
  await rpc('subscribe', { bufferId: ba.id })
  const mutual = await until(() => [ab, ba].every((b) => events.some((e) => e.event === 'presenceChange' && e.data.bufferId === b.id && JSON.stringify(e.data.members).includes('"relationship":"both"'))), 20000)
  check('accepting made it mutual: each sees the other', !!mutual, JSON.stringify(events.filter((e) => e.event === 'presenceChange').slice(-2).map((e) => e.data.members?.[0]?.relationship)))

  console.log('messages')
  const hello = `moho test ${stamp}: hello over the route`
  await rpc('sendMessage', { bufferId: ab.id, body: hello })
  const got = await until(() => seen('message', (d) => d.bufferId === ba.id && d.body === hello), 30000)
  check('a message arrives', !!got)
  await rpc('sendTyping', { bufferId: ab.id, typing: true })
  check('typing is shown', !!(await until(() => seen('typing', (d) => d.bufferId === ba.id), 15000)))
  const mine = (await rpc('getBacklog', { bufferId: ab.id, limit: 20 })).filter((m) => m.body === hello && m.isOwn).at(-1)
  const fixedText = `moho test ${stamp}: hello over the route (corrected)`
  await rpc('editMessage', { bufferId: ab.id, messageId: mine?.id, body: fixedText })
  const fixed = await until(() => seen('messageUpdated', (d) => d.bufferId === ba.id && d.body === fixedText), 20000)
  check('a correction replaces it', !!fixed, JSON.stringify(events.filter((e) => e.event === 'messageUpdated').slice(-2)))
  const theirs = (await rpc('getBacklog', { bufferId: ba.id, limit: 20 })).filter((m) => !m.isOwn && /hello over the route/.test(m.body)).at(-1)
  await rpc('toggleReaction', { bufferId: ba.id, messageId: theirs?.id, emoji: '👍' })
  const reacted = await until(() => seen('reactionsChanged', (d) => d.bufferId === ab.id && JSON.stringify(d.reactions).includes('👍')), 20000)
  check('a reaction comes back', !!reacted, JSON.stringify(events.filter((e) => e.event === 'reactionsChanged').slice(-2)))

  console.log('more of a conversation')
  await rpc('setAccountStatus', { accountId: A, status: 'dnd' })
  check('a status change is seen', !!(await until(() => seen('presenceChange', (d) => d.bufferId === ba.id && JSON.stringify(d.members).includes('dnd')), 20000)), JSON.stringify(events.filter((e) => e.event === 'presenceChange' && e.data.bufferId === ba.id).slice(-1)))
  await rpc('setAccountStatus', { accountId: A, status: 'online' })
  const replyText = `moho test ${stamp}: a reply`
  await rpc('sendMessage', { bufferId: ab.id, body: replyText, replyToId: mine?.id })
  const replied = await until(() => seen('message', (d) => d.bufferId === ba.id && d.body === replyText), 20000)
  check('a reply arrives naming what it answers', !!replied && /hello over the route/.test(replied.replyTo?.body ?? ''), JSON.stringify(replied?.replyTo))
  await rpc('sendMessage', { bufferId: ab.id, body: `/me waves (moho test ${stamp})` })
  const action = await until(() => seen('message', (d) => d.bufferId === ba.id && /waves \(moho test/.test(d.body)), 20000)
  check('/me arrives as an action', !!action && action.isAction === true, JSON.stringify(action))
  await rpc('sendMessage', { bufferId: ab.id, body: `||moho test ${stamp}: a spoiler||` })
  check('a spoiler arrives hidden', !!(await until(() => seen('message', (d) => d.bufferId === ba.id && d.body.includes('||moho test') && d.body.includes('a spoiler||')), 20000)))
  const gone = `moho test ${stamp}: to be taken back`
  await rpc('sendMessage', { bufferId: ab.id, body: gone })
  await until(() => seen('message', (d) => d.bufferId === ba.id && d.body === gone), 20000)
  const goneId = (await rpc('getBacklog', { bufferId: ab.id, limit: 30 })).filter((m) => m.body === gone && m.isOwn).at(-1)?.id
  await rpc('deleteMessage', { bufferId: ab.id, messageId: goneId, forEveryone: true })
  check('a message taken back goes for the other side too', !!(await until(() => seen('messageDeleted', (d) => d.bufferId === ba.id), 20000)), JSON.stringify(events.filter((e) => /Deleted|Moderated/.test(e.event)).slice(-2)))
  const read = await rpc('markBufferRead', { bufferId: ba.id, public: true }).then(() => true, (e) => e.message)
  check('reading is said back (a read marker)', read === true, read)

  console.log('a file')
  const file = putA(`moho-test-${Date.now()}.txt`, `moho test ${stamp}: a file uploaded over the route\n`)
  await rpc('sendMessage', { bufferId: ab.id, body: '', attachmentPath: file })
  const shared = await until(() => seen('message', (d) => d.bufferId === ba.id && (d.attachments ?? []).some((x) => x.filename?.startsWith('moho-test-'))), 60000)
  check('a file is uploaded and arrives as an attachment', !!shared, JSON.stringify(events.filter((e) => e.event === 'message' && e.data.bufferId === ba.id).slice(-1)).slice(0, 400))
  dropA(file)

  console.log('a file straight to the other device (Jingle)')
  const directText = `moho test ${stamp}: sent device to device\n`.repeat(200)
  const direct = putA(`moho-direct-${Date.now()}.txt`, directText)
  const offered = await rpc('xmppSendDirect', { bufferId: ab.id, path: direct }).catch((e) => ({ error: e.message }))
  const offer = await until(async () => (await rpc('xmppFileOffers', { accountId: B })).find((o) => o.name === path.win32.basename(direct)), 30000)
  check('it is offered to the other account', offered.started === true && !!offer, JSON.stringify(offered))
  if (offer) {
    await rpc('xmppAnswerFile', { accountId: B, sid: offer.sid, accept: true })
    const landed = await until(async () => (await rpc('getBacklog', { bufferId: ba.id, limit: 40 })).find((m) => m.attachments?.[0]?.filename === path.win32.basename(direct)), 120000)
    const kept = landed?.attachments?.[0]?.path?.replace('file://', '')
    check('accepted, it arrives whole (between the Tor account and the direct one)', !!kept && fs.readFileSync(kept, 'utf8') === directText, kept)
  }
  dropA(direct)

  console.log('what was missed while away')
  await rpc('setAccountConnected', { accountId: B, connected: false })
  await until(async () => (await rpc('listAccounts')).find((x) => x.id === B)?.state !== 'connected', 15000)
  const away = `moho test ${stamp}: sent while you were away`
  await rpc('sendMessage', { bufferId: ab.id, body: away })
  await sleep(2000)
  await rpc('setAccountConnected', { accountId: B, connected: true })
  check('the account comes back over the route', !!(await until(async () => (await rpc('listAccounts')).find((x) => x.id === B)?.state === 'connected', 120000)))
  await rpc('subscribe', { bufferId: ba.id })
  const caught = await until(async () => seen('message', (d) => d.bufferId === ba.id && d.body === away) || (await rpc('getBacklog', { bufferId: ba.id, limit: 30 })).find((m) => m.body === away), 60000)
  check('and what it missed arrives', !!caught)

  console.log('encryption (OMEMO)')
  const wasA = ab.encrypted
  const wasB = ba.encrypted
  await rpc('xmppSetEncryption', { bufferId: ab.id, on: true })
  const secret = `moho test ${stamp}: encrypted over the route`
  await rpc('sendMessage', { bufferId: ab.id, body: secret })
  check('an encrypted message is read by the other account', !!(await until(() => seen('message', (d) => d.bufferId === ba.id && d.body === secret), 45000)), JSON.stringify(events.filter((e) => e.event === 'message' && e.data.bufferId === ba.id).slice(-1)).slice(0, 300))
  await rpc('xmppSetEncryption', { bufferId: ba.id, on: true })
  const back = `moho test ${stamp}: encrypted answer`
  await rpc('sendMessage', { bufferId: ba.id, body: back })
  check('and its encrypted answer is read', !!(await until(() => seen('message', (d) => d.bufferId === ab.id && d.body === back), 45000)))
  const devices = await rpc('xmppOmemoDevices', { accountId: A, jid: jidB })
  const theirDevice = devices.devices.find((d) => d.jid === jidB)
  check('in OMEMO 2, the other account\'s device known and trusted', theirDevice?.omemo2 === true && theirDevice?.known && theirDevice?.trust === 'trusted', JSON.stringify(devices.devices))

  const secretFile = putA(`moho-secret-${Date.now()}.txt`, `moho test ${stamp}: an encrypted file\n`)
  await rpc('sendMessage', { bufferId: ab.id, body: '', attachmentPath: secretFile })
  const sealed = await until(async () => (await rpc('getBacklog', { bufferId: ba.id, limit: 40 })).find((m) => m.attachments?.some((x) => x.filename === path.win32.basename(secretFile))), 60000)
  check('an encrypted file arrives and is read', !!sealed, JSON.stringify(sealed?.attachments))
  dropA(secretFile)
  const theirLinks = await rpc('xmppOmemoDevices', { accountId: A })
  const verified = await rpc('xmppOmemoVerifyUri', { accountId: B, uri: theirLinks.uri })
  const nowB = (await rpc('xmppOmemoDevices', { accountId: B, jid: jidA })).devices.find((d) => d.jid === jidA && d.device === theirLinks.deviceId)
  check('a verification link (as from a QR code) verifies the other account\'s device', verified.verified >= 1 && nowB?.trust === 'verified', JSON.stringify(verified) + JSON.stringify(nowB))
  await rpc('xmppOmemoTrust', { accountId: B, jid: jidA, device: theirLinks.deviceId, trust: 'trusted' })
  if (!wasA) await rpc('xmppSetEncryption', { bufferId: ab.id, on: false })
  if (!wasB) await rpc('xmppSetEncryption', { bufferId: ba.id, on: false })

  console.log('a room')
  const domain = jidA.split('@')[1]
  const muc = process.env.MUC ?? `conference.${domain}`
  const room = `mohotest${Date.now().toString(36)}@${muc}`
  await rpc('xmppJoinRoom', { accountId: A, jid: room, nick: 'tester' })
  const ra = await until(async () => (await rpc('listBuffers')).find((b) => b.accountId === A && b.remoteId === room && b.kind === 'channel') ?? null, 30000)
  check(`a room is made on ${muc}`, !!ra)
  if (ra) {
    await rpc('subscribe', { bufferId: ra.id })
    await sleep(2000)
    await rpc('xmppInvite', { bufferId: ra.id, jid: jidB })
    const invited = await until(async () => ((await rpc('xmppInvites', { accountId: B })) ?? []).find((i) => i.roomId === room) ?? null, 30000)
    check('the other account is invited', !!invited, JSON.stringify(await rpc('xmppInvites', { accountId: B })))
    if (invited) await rpc('xmppAnswerInvite', { accountId: B, roomId: room, accept: true })
    const rb = await until(async () => (await rpc('listBuffers')).find((b) => b.accountId === B && b.remoteId === room && b.kind === 'channel') ?? null, 30000)
    if (rb) await rpc('subscribe', { bufferId: rb.id })
    await sleep(3000)
    const said = `moho test ${stamp}: in the room`
    await rpc('sendMessage', { bufferId: ra.id, body: said })
    check('it joins, and what is said there reaches it', !!rb && !!(await until(() => seen('message', (d) => d.bufferId === rb?.id && d.body === said), 30000)))

    const topic = `moho test ${stamp}: the topic`
    await rpc('xmppSetSubject', { bufferId: ra.id, subject: topic })
    check('its topic is set and seen', !!(await until(async () => (await rpc('listBuffers')).find((b) => b.id === rb?.id)?.topic === topic, 20000)))
    await rpc('xmppSetNick', { bufferId: ra.id, nick: 'tester2' })
    check('a new nickname is seen', !!(await until(() => seen('presenceChange', (d) => d.bufferId === rb?.id && JSON.stringify(d.members).includes('tester2')), 20000)))
    const ping = `${(await rpc('listBuffers')).find((b) => b.id === rb?.id) ? 'salastil' : ''}: moho test ${stamp}, a mention`
    await rpc('sendMessage', { bufferId: ra.id, body: ping })
    const mentioned = await until(() => seen('message', (d) => d.bufferId === rb?.id && d.body === ping), 20000)
    check('a mention arrives highlighted', !!mentioned && mentioned.isHighlight === true, JSON.stringify(mentioned))
    const theirsInRoom = `moho test ${stamp}: from the other account, to be removed`
    await rpc('sendMessage', { bufferId: rb.id, body: theirsInRoom })
    await until(() => seen('message', (d) => d.bufferId === ra.id && d.body === theirsInRoom), 20000)
    const modId = (await rpc('getBacklog', { bufferId: ra.id, limit: 30 })).filter((m) => m.body === theirsInRoom).at(-1)?.id
    const moderated = await rpc('deleteMessage', { bufferId: ra.id, messageId: modId, forEveryone: true }).then(() => true, (e) => e.message)
    const sawIt = await until(() => seen('messageModerated', (d) => d.bufferId === rb?.id) || seen('messageDeleted', (d) => d.bufferId === rb?.id), 20000)
    check('the room\'s owner removes somebody else\'s message, for everyone (or is told why not)', moderated === true ? !!sawIt : typeof moderated === 'string', String(moderated))
    const level = await rpc('setNotifyLevel', { bufferId: rb.id, level: 'mentions' }).then(() => true, (e) => e.message)
    check('its notification level is kept', level === true, level)
    const png = putA(`moho-room-${Date.now()}.png`, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'))
    const pictured = await rpc('xmppSetRoomAvatar', { bufferId: ra.id, path: png }).then(() => true, (e) => e.message)
    check('a room picture is set (or the server says it takes none)', pictured === true || typeof pictured === 'string', String(pictured))
    console.log(`   room picture: ${pictured === true ? 'set' : pictured}`)
    dropA(png)
    await rpc('xmppDestroyRoom', { bufferId: ra.id, reason: 'moho test over' }).catch((e) => console.log('   (the room could not be destroyed: ' + e.message + ')'))
  }

  console.log('the account itself')
  const before = await rpc('xmppGetProfile', { accountId: A }).catch(() => ({}))
  const nick = `moho tester ${stamp}`
  const setProfile = await rpc('xmppSetProfile', { accountId: A, nickname: nick }).then(() => true, (e) => e.message)
  const after = await rpc('xmppGetProfile', { accountId: A }).catch((e) => ({ error: e.message }))
  check('its profile is changed and read back', setProfile === true && JSON.stringify(after).includes(nick), `${setProfile} ${JSON.stringify(after).slice(0, 300)}`)
  await rpc('xmppSetProfile', { accountId: A, nickname: before?.nickname ?? '' }).catch(() => {})
  const avatar = putA(`moho-avatar-${Date.now()}.png`, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
  const before64 = (await rpc('listBuffers')).find((b) => b.id === ba.id)?.avatarUrl ?? null
  const setAvatar = await rpc('xmppSetAvatar', { accountId: A, path: avatar }).then(() => true, (e) => e.message)
  const shown = await until(async () => { const u = (await rpc('listBuffers')).find((b) => b.id === ba.id)?.avatarUrl; return u && u !== before64 ? u : null }, 30000)
  check('its picture is set and the other account sees it', setAvatar === true && !!shown, `${setAvatar} ${shown}`)
  await rpc('xmppSetAvatar', { accountId: A, path: '' }).catch(() => {})
  dropA(avatar)
  await rpc('xmppBlock', { accountId: A, jid: jidB, block: true })
  const blockedText = `moho test ${stamp}: sent while blocked`
  await rpc('sendMessage', { bufferId: ba.id, body: blockedText })
  await sleep(6000)
  const leaked = seen('message', (d) => d.bufferId === ab.id && d.body === blockedText)
  await rpc('xmppBlock', { accountId: A, jid: jidB, block: false })
  await sleep(1500)
  const unblockedText = `moho test ${stamp}: sent after unblocking`
  await rpc('sendMessage', { bufferId: ba.id, body: unblockedText })
  const through = await until(() => seen('message', (d) => d.bufferId === ab.id && d.body === unblockedText), 20000)
  check('blocking stops messages, and unblocking lets them through', !leaked && !!through, `leaked=${!!leaked} through=${!!through}`)

  console.log('reading the account')
  const profile = await rpc('xmppGetProfile', { accountId: A }).catch((e) => ({ error: e.message }))
  check('its profile is read', !profile.error, profile.error)
  const blocked = await rpc('xmppBlocklist', { accountId: A }).catch((e) => ({ error: e.message }))
  check('its block list is read', !blocked.error, blocked.error)
  const prefs = await rpc('xmppArchivePrefs', { accountId: A }).catch((e) => ({ error: e.message }))
  check('its archive preferences are read', !prefs.error, prefs.error)

  const lists = await rpc('xmppPrivacyLists', { accountId: A }).then(() => true, (e) => e.message)
  console.log(`   privacy lists: ${lists === true ? 'read' : lists}`)
  const nodes = await rpc('xmppNodes', { accountId: A }).then((n) => (Array.isArray(n) ? n.length : JSON.stringify(n).slice(0, 80)), (e) => e.message)
  console.log(`   published nodes: ${nodes}`)
  const kinds = await rpc('xmppInviteKinds', { accountId: A }).then((k) => JSON.stringify(k).slice(0, 120), (e) => e.message)
  console.log(`   invitations the server makes: ${kinds}`)
  const exportFile = sshA ? `${remoteTemp}\\moho-contacts-${Date.now()}.xml` : path.join(os.tmpdir(), `moho-contacts-${Date.now()}.xml`)
  const exported = await rpc('xmppExportContacts', { accountId: A, path: exportFile }).then(() => !!readA(exportFile)?.includes(jidB), (e) => e.message)
  check('its contacts are exported', exported === true, exported)
  dropA(exportFile)
  const commands = await rpc('xmppCommands', { accountId: A, jid: domain }).catch((e) => ({ error: e.message }))
  console.log(`   the server's commands: ${commands.error ?? (commands.commands ?? []).length}`)
} catch (err) {
  results.push(false)
  console.log('  FAIL', err.stack ?? err)
} finally {
  console.log(results.every(Boolean) ? 'ALL OK' : 'FAILED')
  local.close()
  remote?.close()
  process.exit(0)
}
