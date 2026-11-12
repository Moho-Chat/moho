#!/usr/bin/env node
/**
 * Files and pictures over XMPP: a file sent through the server's upload service, one received in each of the forms clients
 * send (a bare link, XEP-0066, XEP-0447), fetched on demand over the account's own trust, and avatars - a contact's, from
 * PEP and from the vCard - and the account's own.
 *
 *   ~/.local/share/moho-dev/xmpp-test.sh up && (cd nobilis && cargo build --release) && node scripts/probe-xmpp-files.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { start, sleep } from './lib/xmpp-daemon.mjs'

// A 2x2 PNG, made here so the probe needs no file.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQImWP8z8Dwn4EIwDiqEF8AAP7xAxfz/dpiAAAAAElFTkSuQmCC', 'base64')
const t = await start({ people: 2 })
const [me, you] = t.accounts
const myId = t.accountId(me)
const dir = fs.mkdtempSync('/tmp/xmpp-files-')
const file = path.join(dir, 'picture.png')
fs.writeFileSync(file, png)
const buffer = async () => (await t.rpc('listBuffers')).find((b) => b.accountId === myId && b.remoteId === you.jid)
const backlog = async (b) => t.rpc('getBacklog', { bufferId: b.id, limit: 50 })
try {
  t.check('the account signs in', await t.signIn(me))
  await sleep(600)
  await t.rpc('xmppAddContact', { accountId: myId, jid: you.jid, name: 'Bea' })
  await t.peer(you, [{ wait_for: 'subscribe', timeout: 8 }, { accept: me.jid }, { sleep: 1 }])
  const b = await t.until(async () => (await buffer()) ?? null)
  await t.rpc('subscribe', { bufferId: b.id })

  console.log('sending')
  await t.rpc('sendMessage', { bufferId: b.id, body: '', attachmentPath: file })
  await sleep(800)
  const sent = (await backlog(b)).find((m) => m.attachments?.length)
  t.check('a file sent is in the conversation at once, with where it will be', sent?.attachments[0]?.kind === 'image' && /^https:\/\/.*\/picture\.png$/.test(sent.attachments[0].url) && sent.attachments[0].filename === 'picture.png', JSON.stringify(sent))
  const wire = await t.peer(you, [{ wait_for: 'file-sharing', timeout: 8 }])
  t.check('and goes out as a link, for old clients, and as a described file, for the rest', wire.received.includes('jabber:x:oob') && wire.received.includes('urn:xmpp:sfs:0') && wire.received.includes('image/png') && wire.received.includes("width='2'"), wire.received.slice(-700))

  console.log('receiving')
  const url = sent.attachments[0].url
  t.events.length = 0
  await t.peer(you, [
    { raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='f-1'><body>${url}</body><origin-id xmlns='urn:xmpp:sid:0' id='f-1'/><x xmlns='jabber:x:oob'><url>${url}</url></x></message>` },
    { sleep: 0.5 },
    { raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='f-2'><body>${url}</body><origin-id xmlns='urn:xmpp:sid:0' id='f-2'/><file-sharing xmlns='urn:xmpp:sfs:0'><file xmlns='urn:xmpp:file:metadata:0'><media-type>image/png</media-type><name>seen.png</name><size>${png.length}</size><dimensions width='2' height='2'/></file><sources><url-data xmlns='http://jabber.org/protocol/url-data' target='${url}'/></sources></file-sharing></message>` },
    { sleep: 0.8 }
  ])
  const oob = t.seen('message', (d) => d.id === 'f-1')
  const sfs = t.seen('message', (d) => d.id === 'f-2')
  t.check('a bare link sent as a file (XEP-0066) is an attachment, and the link is not repeated as text', oob?.attachments?.[0]?.url === url && oob.body === '', JSON.stringify(oob))
  t.check('a described file (XEP-0447) is one with its name and size', sfs?.attachments?.[0]?.filename === 'seen.png' && sfs.attachments[0].size === png.length && sfs.attachments[0].width === 2, JSON.stringify(sfs))
  const cached = sfs.attachments[0].path.replace('file://', '')
  t.check('nothing is fetched until it is looked at', !fs.existsSync(cached))
  const restored = await t.rpc('restoreMedia', { path: sfs.attachments[0].path, bufferId: b.id, messageId: 'f-2' }).catch((e) => ({ error: e.message }))
  t.check('looking fetches it over the account\'s own trust (a private authority)', fs.existsSync(cached) && fs.readFileSync(cached).equals(png), JSON.stringify(restored))

  console.log('pictures of people')
  const hash = '3b6f3a6b6dbd0cd0e2d6e4c8c9d1c4e0b6c9a7a1' // not the picture's: must be refused
  void hash
  const sha1 = (await import('node:crypto')).createHash('sha1').update(png).digest('hex')
  t.events.length = 0
  await t.peer(you, [
    { raw: `<iq xmlns='jabber:client' type='set' id='p1'><pubsub xmlns='http://jabber.org/protocol/pubsub'><publish node='urn:xmpp:avatar:data'><item id='${sha1}'><data xmlns='urn:xmpp:avatar:data'>${png.toString('base64')}</data></item></publish></pubsub></iq>` },
    { sleep: 0.5 },
    { raw: `<iq xmlns='jabber:client' type='set' id='p2'><pubsub xmlns='http://jabber.org/protocol/pubsub'><publish node='urn:xmpp:avatar:metadata'><item id='${sha1}'><metadata xmlns='urn:xmpp:avatar:metadata'><info id='${sha1}' type='image/png' bytes='${png.length}' width='2' height='2'/></metadata></item></publish></pubsub></iq>` },
    { sleep: 2 }
  ])
  const withAvatar = await t.until(async () => (await buffer())?.avatarUrl ?? null, 10000)
  t.check('a contact\'s picture published in PEP becomes the conversation\'s', !!withAvatar && fs.existsSync(withAvatar.replace('file://', '')) && fs.readFileSync(withAvatar.replace('file://', '')).equals(png), withAvatar)
  const members = t.events.filter((e) => e.event === 'presenceChange' && e.data.bufferId === b.id).at(-1)?.data.members
  t.check('and is the one beside their name in the list', members?.some((m) => m.userId === you.jid && m.avatarUrl === withAvatar), JSON.stringify(members)?.slice(0, 300))

  console.log('the account\'s own picture')
  await t.rpc('xmppSetAvatar', { accountId: myId, path: file })
  const check = await t.peer(you, [{ raw: `<iq xmlns='jabber:client' type='get' to='${me.jid}' id='g1'><pubsub xmlns='http://jabber.org/protocol/pubsub'><items node='urn:xmpp:avatar:metadata'/></pubsub></iq>` }, { wait_for: sha1, timeout: 6 }])
  t.check('is published for everybody who sees it', check.received.includes(sha1), check.received.slice(-400))
  let refused = ''
  fs.writeFileSync(path.join(dir, 'x.png'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  await t.rpc('xmppSetAvatar', { accountId: myId, path: path.join(dir, 'x.png') }).catch((e) => (refused = e.message))
  t.check('and what is not a picture is refused', /not a picture/.test(refused), refused)
} catch (err) {
  t.failed(err)
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
  await t.finish()
}
