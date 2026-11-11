#!/usr/bin/env node
/**
 * OMEMO, against another implementation: python-omemo (through slixmpp-omemo), written by other people, is the other device.
 * moho publishes its device and bundle; the other device writes to it and is read; moho writes to the other device and is read;
 * the first message each way is a pre-key message and the ones after it are not; devices and their fingerprints are listed.
 *
 *   ~/.local/share/moho-dev/xmpp-test.sh up && (cd nobilis && cargo build --release) && node scripts/probe-xmpp-omemo.mjs
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { start, sleep, PORT, CONF } from './lib/xmpp-daemon.mjs'
import { root } from './lib/harness.mjs'

const run = promisify(execFile)
const t = await start({ people: 2 })
const [me, you] = t.accounts
const myId = t.accountId(me)
const state = path.join(t.scratch, 'omemo-peer.json')
const omemoPeer = async (steps) => {
  const { stdout } = await run('/1tb/xmpp-test/venv/bin/python', [path.join(root, 'scripts/lib/xmpp-omemo-peer.py'), you.name, JSON.stringify(steps)], {
    env: { ...process.env, XMPP_TEST_ACCOUNTS: path.join(t.scratch, 'accounts.txt'), XMPP_OMEMO_STATE: state, XMPP_TEST_PORT: String(PORT) },
    maxBuffer: 1 << 24
  })
  return JSON.parse(stdout.split('\n').filter((l) => l.startsWith('{')).at(-1))
}
try {
  t.check('the account signs in', await t.signIn(me))
  await sleep(1500)
  console.log('this device and the other')
  const own = await t.rpc('xmppOmemoDevices', { accountId: myId })
  t.check('this device has an id and a fingerprint of its own, and is in its own list', own.deviceId > 0 && /^[0-9a-f ]{40,}$/.test(own.fingerprint) && own.devices.some((d) => d.own), JSON.stringify(own).slice(0, 300))

  await t.rpc('xmppAddContact', { accountId: myId, jid: you.jid, name: 'Bea' })
  await t.peer(you, [{ wait_for: 'subscribe', timeout: 8 }, { accept: me.jid }, { sleep: 1 }])
  const b = await t.until(async () => (await t.rpc('listBuffers')).find((x) => x.accountId === myId && x.remoteId === you.jid) ?? null)
  await t.rpc('subscribe', { bufferId: b.id })
  // The other client makes its device and publishes it.
  const first = await omemoPeer([{ sleep: 2 }])
  t.check('the other client signs in and publishes its device', first.ok, first.failed)

  console.log('encrypting')
  await t.rpc('xmppSetEncryption', { bufferId: b.id, on: true })
  t.check('encryption turns on once there is a device to encrypt to', !!(await t.until(async () => (await t.rpc('listBuffers')).find((x) => x.id === b.id)?.encrypted === true)))
  await t.rpc('sendMessage', { bufferId: b.id, body: 'a secret from moho' })
  const read = await omemoPeer([{ expect: 'a secret from moho', timeout: 20 }])
  t.check('what moho sends is read by the other implementation', read.received.includes('a secret from moho'), JSON.stringify(read.received) + read.failed)
  const bl = await t.rpc('getBacklog', { bufferId: b.id, limit: 20 })
  t.check('here it is the plain words, as sent', bl.some((m) => m.body === 'a secret from moho' && m.isOwn))

  t.events.length = 0
  const answered = await omemoPeer([{ send: 'an answer, encrypted', to: me.jid }, { sleep: 1.5 }])
  t.check('the other implementation sends and it is read here', !!t.seen('message', (d) => d.body === 'an answer, encrypted'), JSON.stringify(answered.received) + answered.failed + JSON.stringify(t.events.filter((e) => e.event === 'message').map((e) => e.data.body)))
  t.events.length = 0
  await omemoPeer([{ send: 'a second one', to: me.jid }, { sleep: 1.5 }])
  t.check('and the next, which is an ordinary message of the session', !!t.seen('message', (d) => d.body === 'a second one'))
  await t.rpc('sendMessage', { bufferId: b.id, body: 'a second from moho' })
  const again = await omemoPeer([{ expect: 'a second from moho', timeout: 20 }])
  t.check('moho writes again on the same session', again.received.includes('a second from moho'), JSON.stringify(again.received))

  console.log('who is trusted')
  const devices = await t.rpc('xmppOmemoDevices', { accountId: myId, jid: you.jid })
  const theirs = devices.devices.find((d) => d.jid === you.jid)
  t.check('the other person\'s device is listed with its fingerprint and trusted', theirs?.known && theirs.trust === 'trusted' && theirs.fingerprint.length > 40, JSON.stringify(devices).slice(0, 400))
  await t.rpc('xmppOmemoTrust', { accountId: myId, jid: you.jid, device: theirs.device, trust: 'untrusted' })
  let refused = ''
  await t.rpc('sendMessage', { bufferId: b.id, body: 'to nobody' }).catch((e) => (refused = e.message))
  t.check('a device that is not trusted is not written to, and the person is told', /None of .* devices can be encrypted to/.test(refused), refused)
  await t.rpc('xmppOmemoTrust', { accountId: myId, jid: you.jid, device: theirs.device, trust: 'verified' })
  await t.rpc('sendMessage', { bufferId: b.id, body: 'verified now' })
  const verified = await omemoPeer([{ expect: 'verified now', timeout: 20 }])
  t.check('once it is trusted again it is', verified.received.includes('verified now'), JSON.stringify(verified.received))

  console.log('files')
  await t.rpc('xmppSetEncryption', { bufferId: b.id, on: true })
  const secretFile = path.join(t.scratch, 'secret.txt')
  fs.writeFileSync(secretFile, 'the words in an encrypted file')
  await t.rpc('sendMessage', { bufferId: b.id, body: '', attachmentPath: secretFile })
  const gotFile = await omemoPeer([{ expect_file: 'the words in an encrypted file', timeout: 20 }])
  t.check('an encrypted file is fetched and decrypted by the other implementation', gotFile.received.includes('FILE-OK:the words in an encrypted file'), JSON.stringify(gotFile.received) + gotFile.failed)
  const sentFile = (await t.rpc('getBacklog', { bufferId: b.id, limit: 30 })).find((m) => m.attachments?.length && /^aesgcm:\/\//.test(m.attachments[0].url))
  t.check('and here it is an attachment whose link carries the key', !!sentFile && sentFile.attachments[0].filename === 'secret.txt', JSON.stringify(sentFile))

  console.log('a room')
  const room = `omemoroom${t.stamp}@${CONF}`
  await t.rpc('xmppJoinRoom', { accountId: myId, jid: room, nick: 'mohonick' })
  const rb = await t.until(async () => (await t.rpc('listBuffers')).find((x) => x.accountId === myId && x.remoteId === room && x.kind === 'channel') ?? null)
  await t.rpc('subscribe', { bufferId: rb.id })
  await sleep(1500)
  let hidden = ''
  await t.rpc('xmppSetEncryption', { bufferId: rb.id, on: true }).catch((e) => (hidden = e.message))
  t.check('a room that hides addresses cannot be encrypted, and says why', /does not show people's addresses/.test(hidden), hidden)
  await t.rpc('xmppSetRoomConfig', { bufferId: rb.id, answers: { 'muc#roomconfig_whois': 'anyone', 'muc#roomconfig_membersonly': true, 'muc#roomconfig_persistentroom': true } })
  await t.rpc('xmppRoomAction', { bufferId: rb.id, action: 'member', jid: you.jid })
  await sleep(800)
  t.events.length = 0
  const inRoom = omemoPeer([{ join: room, nick: 'peer' }, { sleep: 1 }, { send_room: 'hello encrypted room', room, recipients: [me.jid] }, { expect: 'a reply from moho in the room', timeout: 40 }])
  await t.until(async () => (await t.rpc('listBuffers')).find((x) => x.id === rb.id) && t.events.some((e) => e.event === 'presenceChange' && e.data.members?.some((m) => m.nick === 'peer')), 20000)
  await sleep(1500)
  await t.rpc('xmppSetEncryption', { bufferId: rb.id, on: true })
  await sleep(3000)
  await t.rpc('sendMessage', { bufferId: rb.id, body: 'a reply from moho in the room' })
  const roomRead = await inRoom
  t.check('what the other implementation says in an encrypted room is read here', !!(await t.until(async () => (await t.rpc('getBacklog', { bufferId: rb.id, limit: 50 })).some((m) => m.body === 'hello encrypted room'), 5000)) || !!t.seen('message', (d) => d.body === 'hello encrypted room'), JSON.stringify(roomRead.received) + roomRead.failed)
  t.check('and what moho says there is read by it', roomRead.received.includes('a reply from moho in the room'), JSON.stringify(roomRead.received) + roomRead.failed)
  const mine = (await t.rpc('getBacklog', { bufferId: rb.id, limit: 50 })).filter((m) => m.body === 'a reply from moho in the room')
  t.check('shown once here, as its own', mine.length === 1 && mine[0].isOwn, JSON.stringify(mine))

  console.log('turning it off')
  await t.rpc('xmppSetEncryption', { bufferId: b.id, on: false })
  await t.rpc('sendMessage', { bufferId: b.id, body: 'in the clear' })
  const plain = await t.peer(you, [{ wait_for: 'in the clear', timeout: 10 }])
  t.check('a conversation that is not encrypted is sent as plain text', plain.received.includes('in the clear') && !/<encrypted[^>]*axolotl[^>]*>[^<]*<header[^>]*>[^]*in the clear/.test(plain.received))
} catch (err) {
  t.failed(err)
} finally {
  await t.finish()
}
