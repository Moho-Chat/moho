#!/usr/bin/env node
/**
 * Verifying OMEMO keys, and Automatic Trust Management (XEP-0450), against python-omemo devices whose trust messages are made
 * and read by scripts/lib/xmpp-omemo-peer.py (python-omemo has no ATM):
 *
 * - this device's verification links and their QR codes (the form most clients scan, and XEP-0434's);
 * - a link scanned from the other person's device verifies that device, and moho tells it, in a trust message, which keys of
 *   this account it can trust in turn;
 * - a trust message from a verified device about a key moho has not seen yet verifies that key's device when it shows up;
 * - a trust message from a device that is not verified is kept, not applied, until that device is verified (by a
 *   trust-message link), and then applied;
 * - trust messages are never shown as messages.
 *
 *   node scripts/probe-xmpp-omemo-trust.mjs       XMPP_TEST_SERVER=prosody node scripts/probe-xmpp-omemo-trust.mjs
 */
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { start, sleep, PORT } from './lib/xmpp-daemon.mjs'
import { root } from './lib/harness.mjs'

const run = promisify(execFile)
const t = await start({ people: 2 })
const [me, you] = t.accounts
const myId = t.accountId(me)
const omemoPeer = async (device, steps) => {
  const { stdout } = await run('/1tb/xmpp-test/venv/bin/python', [path.join(root, 'scripts/lib/xmpp-omemo-peer.py'), you.name, JSON.stringify(steps)], {
    env: { ...process.env, XMPP_TEST_ACCOUNTS: path.join(t.scratch, 'accounts.txt'), XMPP_OMEMO_STATE: path.join(t.scratch, `omemo-peer-${device}.json`), XMPP_TEST_PORT: String(PORT) },
    maxBuffer: 1 << 24
  })
  return JSON.parse(stdout.split('\n').filter((l) => l.startsWith('{')).at(-1))
}
const said = (r) => JSON.stringify(r.received) + (r.failed ?? '')
const whoami = async (device) => {
  const r = await omemoPeer(device, [{ sleep: 1 }, { whoami: true }])
  const [, id, key] = r.received.find((x) => x.startsWith('WHOAMI:')).split(':')
  return { id: Number(id), key }
}
const trustOf = async (key) => {
  const list = await t.rpc('xmppOmemoDevices', { accountId: myId, jid: you.jid })
  return list.devices.find((d) => d.jid === you.jid && d.fingerprint.replaceAll(' ', '') === key)?.trust ?? 'unseen'
}
try {
  t.check('the account signs in', await t.signIn(me))
  await t.rpc('xmppAddContact', { accountId: myId, jid: you.jid, name: 'Bea' })
  await t.peer(you, [{ wait_for: 'subscribe', timeout: 8 }, { accept: me.jid }, { sleep: 1 }])
  const b = await t.until(async () => (await t.rpc('listBuffers')).find((x) => x.accountId === myId && x.remoteId === you.jid) ?? null)
  await t.rpc('subscribe', { bufferId: b.id })

  console.log("this device's links")
  const own = await t.rpc('xmppOmemoDevices', { accountId: myId })
  const ownKey = own.fingerprint.replaceAll(' ', '')
  t.check('the form most clients scan names this device and its key', own.uri === `xmpp:${me.jid}?omemo-sid-${own.deviceId}=05${ownKey};omemo2-sid-${own.deviceId}=${ownKey}`, own.uri)
  t.check("and XEP-0434's trust-message link", own.trustUri === `xmpp:${me.jid}?trust-message;encryption=urn:xmpp:omemo:2;trust=${ownKey}`, own.trustUri)
  t.check('each with its QR code', /<svg/.test(own.qr ?? '') && /<svg/.test(own.trustQr ?? ''))

  console.log('a link scanned from the other device')
  const a = await whoami('a')
  const listening = omemoPeer('a', [{ expect_start: 'TRUST:', timeout: 30 }])
  await sleep(5000)
  const v = await t.rpc('xmppOmemoVerifyUri', { accountId: myId, uri: `xmpp:${you.jid}?omemo2-sid-${a.id}=${a.key}` })
  t.check('verifies that device', v.verified === 1 && (await trustOf(a.key)) === 'verified', JSON.stringify(v) + (await trustOf(a.key)))
  const heard = await listening
  const tm = JSON.parse(heard.received.find((x) => x.startsWith('TRUST:'))?.slice(6) ?? '[]')
  const ownB64 = Buffer.from(ownKey, 'hex').toString('base64')
  t.check('and that device is told, in a trust message, the keys of this account it can trust', tm.length === 1 && tm[0].jid === me.jid && tm[0].trust.includes(ownB64), said(heard))

  console.log('a trust message from the verified device about a key not seen yet')
  const second = await whoami('b')
  t.events.length = 0
  await omemoPeer('a', [{ send_trust: [{ jid: you.jid, trust: [second.key] }], to: me.jid }, { sleep: 2 }])
  await omemoPeer('b', [{ send2: 'hello from the second device', to: me.jid }, { sleep: 2 }])
  t.check('the key is verified when its device shows up', !!(await t.until(async () => (await trustOf(second.key)) === 'verified', 10000)), await trustOf(second.key))
  t.check('the trust message was not shown as a message', !t.seen('message', (d) => /encrypted|trust/i.test(d.body ?? '')), JSON.stringify(t.events.filter((e) => e.event === 'message').map((e) => e.data.body)))

  console.log('a trust message from a device that is not verified')
  const third = await whoami('c')
  await omemoPeer('c', [{ send_trust: [{ jid: you.jid, distrust: [a.key] }], to: me.jid }, { sleep: 2 }])
  await sleep(1000)
  t.check('is kept, not applied', (await trustOf(a.key)) === 'verified' && (await trustOf(third.key)) !== 'verified', `${await trustOf(a.key)} ${await trustOf(third.key)}`)
  const v3 = await t.rpc('xmppOmemoVerifyUri', { accountId: myId, uri: `xmpp:${you.jid}?trust-message;encryption=urn:xmpp:omemo:2;trust=${third.key}` })
  t.check('once that device is verified (a trust-message link), what it said is applied', v3.verified === 1 && (await trustOf(third.key)) === 'verified' && (await trustOf(a.key)) === 'untrusted', `${JSON.stringify(v3)} ${await trustOf(third.key)} ${await trustOf(a.key)}`)

  console.log('links that are not verification links')
  const bad = await t.rpc('xmppOmemoVerifyUri', { accountId: myId, uri: `xmpp:${you.jid}?message;body=hello` }).catch((e) => e.message)
  t.check('are refused in words', /not an OMEMO verification link/.test(bad), bad)
} catch (err) {
  t.failed(err)
} finally {
  await t.finish()
}
