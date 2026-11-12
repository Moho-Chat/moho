#!/usr/bin/env node
/**
 * OMEMO 2 (urn:xmpp:omemo:2), against another implementation: python-omemo's twomemo, through slixmpp-omemo, with the Stanza
 * Content Encryption envelope opened and made by scripts/lib/xmpp-omemo-peer.py (the plugin has none).
 *
 * - moho publishes its device and bundle under OMEMO 2 as well as the older namespace, with the same identity;
 * - moho writes to a device that speaks OMEMO 2 in OMEMO 2, and is read; the other device answers and is read here;
 * - a device that starts the session itself (a key exchange moho has to accept) is read, and answered;
 * - a message whose envelope says it is from somebody else is not shown as theirs;
 * - one message to a person with a device that speaks only the older namespace reaches both, each in its own;
 * - an encrypted room, in OMEMO 2 both ways.
 *
 *   ~/.local/share/moho-dev/xmpp-test.sh up && (cd nobilis && cargo build --release) && node scripts/probe-xmpp-omemo2.mjs
 *   XMPP_TEST_SERVER=prosody node scripts/probe-xmpp-omemo2.mjs
 */
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { start, sleep, PORT, CONF } from './lib/xmpp-daemon.mjs'
import { root } from './lib/harness.mjs'

const run = promisify(execFile)
const t = await start({ people: 2 })
const [me, you] = t.accounts
const myId = t.accountId(me)
/** The other person's devices: each is a state file (its keys), and `old` makes one that speaks only the older namespace. */
const omemoPeer = async (device, steps, { old = false } = {}) => {
  const { stdout } = await run('/1tb/xmpp-test/venv/bin/python', [path.join(root, 'scripts/lib/xmpp-omemo-peer.py'), you.name, JSON.stringify(steps)], {
    env: {
      ...process.env,
      XMPP_TEST_ACCOUNTS: path.join(t.scratch, 'accounts.txt'),
      XMPP_OMEMO_STATE: path.join(t.scratch, `omemo-peer-${device}.json`),
      XMPP_TEST_PORT: String(PORT),
      XMPP_OMEMO_VERSIONS: old ? 'old' : 'both'
    },
    maxBuffer: 1 << 24
  })
  return JSON.parse(stdout.split('\n').filter((l) => l.startsWith('{')).at(-1))
}
const said = (r) => JSON.stringify(r.received) + (r.failed ?? '')
try {
  t.check('the account signs in', await t.signIn(me))
  await sleep(1500)
  const own = await t.until(async () => {
    const r = await t.rpc('xmppOmemoDevices', { accountId: myId })
    return r.devices.some((d) => d.own && d.omemo2) ? r : null
  }, 10000)
  t.check('this device is published under OMEMO 2 too', !!own)

  await t.rpc('xmppAddContact', { accountId: myId, jid: you.jid, name: 'Bea' })
  await t.peer(you, [{ wait_for: 'subscribe', timeout: 8 }, { accept: me.jid }, { sleep: 1 }])
  const b = await t.until(async () => (await t.rpc('listBuffers')).find((x) => x.accountId === myId && x.remoteId === you.jid) ?? null)
  await t.rpc('subscribe', { bufferId: b.id })
  const first = await omemoPeer('a', [{ sleep: 2 }])
  t.check('the other client signs in and publishes its device', first.ok, first.failed)
  const listed = await t.rpc('xmppOmemoDevices', { accountId: myId, jid: you.jid })
  const theirs = listed.devices.find((d) => d.jid === you.jid)
  t.check('its device is listed as speaking OMEMO 2', theirs?.omemo2 === true, JSON.stringify(listed.devices))

  console.log('moho writes first')
  await t.rpc('xmppSetEncryption', { bufferId: b.id, on: true })
  await t.rpc('sendMessage', { bufferId: b.id, body: 'a secret in OMEMO 2' })
  const read = await omemoPeer('a', [{ expect: 'a secret in OMEMO 2', timeout: 20 }])
  t.check('the other implementation reads it, in OMEMO 2', read.received.includes('OMEMO2:a secret in OMEMO 2'), said(read))
  t.check('and it carried nothing in the older namespace for a device that speaks OMEMO 2', !/eu\.siacs\.conversations\.axolotl'?"?>[^]*a secret/.test(read.raw) && /urn:xmpp:omemo:2/.test(read.raw), read.raw.slice(-600))
  const known = (await t.rpc('xmppOmemoDevices', { accountId: myId, jid: you.jid })).devices.find((d) => d.jid === you.jid)
  t.check('the device has a fingerprint and is trusted', known?.known && known.trust === 'trusted', JSON.stringify(known))

  t.events.length = 0
  const answered = await omemoPeer('a', [{ send2: 'an answer in OMEMO 2', to: me.jid }, { sleep: 1.5 }, { send2: 'and another', to: me.jid }, { sleep: 1.5 }])
  t.check('its answer is read here', !!(await t.until(async () => t.seen('message', (d) => d.body === 'an answer in OMEMO 2'), 8000)), said(answered) + JSON.stringify(t.events.filter((e) => e.event === 'message').map((e) => e.data.body)))
  t.check('and the next', !!(await t.until(async () => t.seen('message', (d) => d.body === 'and another'), 8000)))
  await t.rpc('sendMessage', { bufferId: b.id, body: 'moho again' })
  const again = await omemoPeer('a', [{ expect: 'moho again', timeout: 20 }])
  t.check('moho writes again on the same session', again.received.includes('OMEMO2:moho again'), said(again))

  console.log('a device that starts the session itself')
  t.events.length = 0
  const fresh = omemoPeer('b', [{ sleep: 1 }, { send2: 'hello from a new device', to: me.jid }, { expect: 'welcome, new device', timeout: 30 }])
  t.check('its first message (a key exchange) is read here', !!(await t.until(async () => t.seen('message', (d) => d.body === 'hello from a new device'), 25000)), JSON.stringify(t.events.filter((e) => e.event === 'message').map((e) => e.data.body)))
  await t.rpc('sendMessage', { bufferId: b.id, body: 'welcome, new device' })
  const welcomed = await fresh
  t.check('and moho answers it on the session it started', welcomed.received.includes('OMEMO2:welcome, new device'), said(welcomed))

  console.log('an envelope that lies about who it is from')
  t.events.length = 0
  await omemoPeer('a', [{ send2: 'it is me, the admin', to: me.jid, says_from: `admin@${me.jid.split('@')[1]}` }, { sleep: 1.5 }])
  const lie = await t.until(async () => t.seen('message', (d) => /could not be read/.test(d.body ?? '')), 8000)
  t.check('is not shown as their words, and says why', !!lie && /somebody other than who sent it/.test(lie.body) && !t.seen('message', (d) => d.body === 'it is me, the admin'), JSON.stringify(lie))

  console.log('a device that speaks only the older namespace')
  const both = [
    omemoPeer('a', [{ expect: 'to every device', timeout: 40 }]),
    omemoPeer('c', [{ expect: 'to every device', timeout: 40 }], { old: true })
  ]
  await sleep(7000)
  await t.rpc('sendMessage', { bufferId: b.id, body: 'to every device' })
  const [newer, older] = await Promise.all(both)
  t.check('the OMEMO 2 device reads it in OMEMO 2', newer.received.includes('OMEMO2:to every device'), said(newer))
  t.check('the other reads it in the older namespace', older.received.includes('to every device') && !older.received.includes('OMEMO2:to every device'), said(older))

  console.log('a room')
  const room = `omemo2room${t.stamp}@${CONF}`
  await t.rpc('xmppJoinRoom', { accountId: myId, jid: room, nick: 'mohonick' })
  const rb = await t.until(async () => (await t.rpc('listBuffers')).find((x) => x.accountId === myId && x.remoteId === room && x.kind === 'channel') ?? null)
  await t.rpc('subscribe', { bufferId: rb.id })
  await sleep(1500)
  await t.rpc('xmppSetRoomConfig', { bufferId: rb.id, answers: { 'muc#roomconfig_whois': 'anyone', 'muc#roomconfig_membersonly': true, 'muc#roomconfig_persistentroom': true } })
  await t.rpc('xmppRoomAction', { bufferId: rb.id, action: 'member', jid: you.jid })
  await sleep(800)
  t.events.length = 0
  const inRoom = omemoPeer('a', [{ join: room, nick: 'peer' }, { sleep: 1 }, { send2: 'hello encrypted room', to: room, type: 'groupchat', recipients: [me.jid] }, { expect: 'a reply in the room', timeout: 40 }])
  await t.until(async () => t.events.some((e) => e.event === 'presenceChange' && e.data.members?.some((m) => m.nick === 'peer')), 20000)
  await sleep(1500)
  await t.rpc('xmppSetEncryption', { bufferId: rb.id, on: true })
  await sleep(2000)
  await t.rpc('sendMessage', { bufferId: rb.id, body: 'a reply in the room' })
  const roomRead = await inRoom
  t.check('what the other implementation says in an encrypted room is read here', !!(await t.until(async () => (await t.rpc('getBacklog', { bufferId: rb.id, limit: 50 })).some((m) => m.body === 'hello encrypted room'), 5000)), said(roomRead))
  t.check('and what moho says there is read by it, in OMEMO 2', roomRead.received.includes('OMEMO2:a reply in the room'), said(roomRead))
} catch (err) {
  t.failed(err)
} finally {
  await t.finish()
}
