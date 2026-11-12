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

const [A, B] = process.argv.slice(2)
if (!A || !B) throw new Error('usage: probe-xmpp-live.mjs xmpp:sender@server xmpp:receiver@server')
const jidA = A.slice(5)
const jidB = B.slice(5)
const sock = path.join(process.env.XDG_RUNTIME_DIR ?? '/run/user/1000', 'nobilis', 'nobilis.sock')
const conn = net.connect(sock)
const events = []
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
const rpc = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    waiting.set(id, (m) => (m.error ? reject(new Error(typeof m.error === 'string' ? m.error : JSON.stringify(m.error))) : resolve(m.result)))
    conn.write(JSON.stringify({ id, method, params }) + '\n')
  })
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

  console.log('contacts')
  await rpc('xmppAddContact', { accountId: A, jid: jidB, name: 'test receiver' })
  const asked = await until(async () => ((await rpc('xmppRequests', { accountId: B })).requests ?? []).find((r) => r.jid === jidA) ?? null, 20000)
  if (asked) await rpc('xmppAnswerRequest', { accountId: B, jid: jidA, accept: true })
  const ab = await dm(A, jidB)
  const ba = await dm(B, jidA)
  check('each has a conversation with the other', !!ab && !!ba, `${!!ab} ${!!ba} (asked: ${!!asked})`)
  await rpc('subscribe', { bufferId: ab.id })
  await rpc('subscribe', { bufferId: ba.id })

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

  console.log('a file')
  const file = path.join(os.tmpdir(), `moho-test-${Date.now()}.txt`)
  fs.writeFileSync(file, `moho test ${stamp}: a file uploaded over the route\n`)
  await rpc('sendMessage', { bufferId: ab.id, body: '', attachmentPath: file })
  const shared = await until(() => seen('message', (d) => d.bufferId === ba.id && (d.attachments ?? []).some((x) => x.filename?.startsWith('moho-test-'))), 60000)
  check('a file is uploaded and arrives as an attachment', !!shared, JSON.stringify(events.filter((e) => e.event === 'message' && e.data.bufferId === ba.id).slice(-1)).slice(0, 400))
  fs.rmSync(file, { force: true })

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
    await rpc('xmppDestroyRoom', { bufferId: ra.id, reason: 'moho test over' }).catch((e) => console.log('   (the room could not be destroyed: ' + e.message + ')'))
  }

  console.log('reading the account')
  const profile = await rpc('xmppGetProfile', { accountId: A }).catch((e) => ({ error: e.message }))
  check('its profile is read', !profile.error, profile.error)
  const blocked = await rpc('xmppBlocklist', { accountId: A }).catch((e) => ({ error: e.message }))
  check('its block list is read', !blocked.error, blocked.error)
  const prefs = await rpc('xmppArchivePrefs', { accountId: A }).catch((e) => ({ error: e.message }))
  check('its archive preferences are read', !prefs.error, prefs.error)
  const commands = await rpc('xmppCommands', { accountId: A, jid: domain }).catch((e) => ({ error: e.message }))
  console.log(`   the server's commands: ${commands.error ?? (commands.commands ?? []).length}`)
} catch (err) {
  results.push(false)
  console.log('  FAIL', err.stack ?? err)
} finally {
  console.log(results.every(Boolean) ? 'ALL OK' : 'FAILED')
  conn.end()
  process.exit(0)
}
