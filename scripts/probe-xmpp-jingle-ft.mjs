#!/usr/bin/env node
/**
 * Files sent device to device (Jingle File Transfer, XEP-0234, over In-Band Bytestreams, XEP-0261/0047): between two moho
 * accounts - offered, accepted on the Invitations tile, arriving whole and checked against its hash, or declined and said so -
 * and from another client (slixmpp writing the stanzas as Dino and Conversations do).
 *
 *   node scripts/probe-xmpp-jingle-ft.mjs        (ejabberd)        XMPP_TEST_SERVER=prosody node scripts/probe-xmpp-jingle-ft.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { start, sleep } from './lib/xmpp-daemon.mjs'

const t = await start({ people: 3 })
const [me, you, other] = t.accounts
const [myId, yourId] = [t.accountId(me), t.accountId(you)]
const backlog = async (bufferId) => ((await t.rpc('getBacklog', { bufferId, limit: 50 })) ?? [])
const bufferOf = async (accountId, jid) => t.until(async () => (await t.rpc('listBuffers')).find((b) => b.accountId === accountId && b.remoteId === jid) ?? null)
try {
  for (const p of [me, you]) await t.signIn(p)
  await t.rpc('xmppAddContact', { accountId: myId, jid: you.jid, name: 'You' })
  await t.until(async () => (await t.rpc('xmppRequests', { accountId: yourId })).requests.some((r) => r.jid === me.jid))
  await t.rpc('xmppAnswerRequest', { accountId: yourId, jid: me.jid, accept: true })
  await t.rpc('xmppAddContact', { accountId: yourId, jid: me.jid, name: 'Me' })
  await sleep(2500)
  t.check('two contacts, both online', true)

  console.log('from one moho to another')
  const file = path.join(t.scratch, 'notes.txt')
  const content = crypto.randomBytes(20000).toString('base64')
  fs.writeFileSync(file, content)
  const mine = await bufferOf(myId, you.jid)
  const r = await t.rpc('xmppSendDirect', { bufferId: mine.id, path: file })
  t.check('the offer is made', r.started === true, JSON.stringify(r))
  const offer = await t.until(async () => (await t.rpc('xmppFileOffers', { accountId: yourId })).find((o) => o.name === 'notes.txt'), 10000)
  t.check('and waits to be answered, saying what it is', offer?.from === me.jid && offer.size === content.length, JSON.stringify(offer))
  await t.rpc('xmppAnswerFile', { accountId: yourId, sid: offer.sid, accept: true })
  const theirs = await bufferOf(yourId, me.jid)
  const got = await t.until(async () => (await backlog(theirs.id)).find((m) => m.attachments?.[0]?.filename === 'notes.txt'), 30000)
  const kept = got?.attachments?.[0]?.path?.replace('file://', '')
  t.check('accepted, it arrives whole', !!kept && fs.readFileSync(kept, 'utf8') === content, kept)
  t.check('and the sender sees it sent', !!(await t.until(async () => (await backlog(mine.id)).find((m) => m.isOwn && m.attachments?.[0]?.filename === 'notes.txt'), 10000)))

  await t.rpc('xmppSendDirect', { bufferId: mine.id, path: file })
  const second = await t.until(async () => (await t.rpc('xmppFileOffers', { accountId: yourId }))[0], 10000)
  await t.rpc('xmppAnswerFile', { accountId: yourId, sid: second.sid, accept: false })
  t.check('declined, the sender is told', !!(await t.until(async () => (await backlog(mine.id)).find((m) => m.kind === 'system' && /was not sent: .*did not take the file/.test(m.body)), 10000)), JSON.stringify((await backlog(mine.id)).slice(-2)))

  console.log('from another client')
  const resource = /\[\[xmpp_account\]\][^[]*?jid = "([^"]+)"[^[]*?resource = "([^"]+)"/g
  const toml = t.accountsToml()
  let full = ''
  for (const m of toml.matchAll(resource)) if (m[1] === me.jid) full = `${me.jid}/${m[2]}`
  await t.rpc('xmppAddContact', { accountId: myId, jid: other.jid, name: 'Other' })
  const data = Buffer.from('a file from somebody else\n'.repeat(300))
  const sha = crypto.createHash('sha256').update(data).digest('base64')
  const blocks = []
  for (let i = 0, seq = 0; i < data.length; i += 3000, seq++) blocks.push({ raw: `<iq xmlns='jabber:client' type='set' id='d${seq}' to='${full}'><data xmlns='http://jabber.org/protocol/ibb' seq='${seq}' sid='ibb1'>${data.subarray(i, i + 3000).toString('base64')}</data></iq>` }, { wait_for: `id='d${seq}'`, timeout: 8 })
  const sending = t.peer(other, [
    { wait_for: 'subscribe', timeout: 8 },
    { accept: me.jid },
    { sleep: 1.5 },
    { raw: `<iq xmlns='jabber:client' type='set' id='init' to='${full}'><jingle xmlns='urn:xmpp:jingle:1' action='session-initiate' sid='ft1' initiator='{{from_of:x}}'><content creator='initiator' name='a-file-offer' senders='initiator'><description xmlns='urn:xmpp:jingle:apps:file-transfer:5'><file><media-type>text/plain</media-type><name>from-dino.txt</name><size>${data.length}</size><hash xmlns='urn:xmpp:hashes:2' algo='sha-256'>${sha}</hash></file></description><transport xmlns='urn:xmpp:jingle:transports:ibb:1' block-size='3000' sid='ibb1'/></content></jingle></iq>`.replace(" initiator='{{from_of:x}}'", '') },
    { wait_for: 'session-accept', timeout: 20 },
    { raw: `<iq xmlns='jabber:client' type='set' id='open' to='${full}'><open xmlns='http://jabber.org/protocol/ibb' block-size='3000' sid='ibb1' stanza='iq'/></iq>` },
    { wait_for: "id='open'", timeout: 8 },
    ...blocks,
    { raw: `<iq xmlns='jabber:client' type='set' id='close' to='${full}'><close xmlns='http://jabber.org/protocol/ibb' sid='ibb1'/></iq>` },
    { wait_for: "id='close'", timeout: 8 },
    { wait_for: 'session-terminate', timeout: 10 }
  ])
  const theirOffer = await t.until(async () => (await t.rpc('xmppFileOffers', { accountId: myId })).find((o) => o.name === 'from-dino.txt'), 15000)
  t.check("another client's offer waits on the tile", !!theirOffer, JSON.stringify(await t.rpc('xmppFileOffers', { accountId: myId })))
  if (theirOffer) await t.rpc('xmppAnswerFile', { accountId: myId, sid: theirOffer.sid, accept: true })
  const out = await sending
  t.check('accepting answers it in its words (session-accept), and the session ends in success', /session-accept/.test(out.received) && /<success\/>/.test(out.received), out.received.slice(-400))
  const fromOther = await bufferOf(myId, other.jid)
  const arrived = await t.until(async () => (await backlog(fromOther.id)).find((m) => m.attachments?.[0]?.filename === 'from-dino.txt'), 10000)
  const at = arrived?.attachments?.[0]?.path?.replace('file://', '')
  t.check('and the file is the one that was sent, checked against its hash', !!at && fs.readFileSync(at).equals(data), at)
} catch (err) {
  t.failed(err)
} finally {
  await t.finish()
}
