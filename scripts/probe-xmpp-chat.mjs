#!/usr/bin/env node
/**
 * One-to-one chat over XMPP, as the daemon does it, with another client (slixmpp) as the other person: the roster and who
 * is present, messages both ways, receipts and markers, typing, corrections, retractions, reactions, replies, carbons from
 * another device, and what the archive brings back after being away - and that none of it is shown twice.
 *
 *   ~/.local/share/moho-dev/xmpp-test.sh up
 *   (cd nobilis && cargo build --release)
 *   node scripts/probe-xmpp-chat.mjs
 *
 * It makes two accounts on the test server for the run and removes them after, so each run starts from nothing. The
 * daemon is its own, in a scratch HOME and XDG_RUNTIME_DIR: never the live one.
 */
import { spawn, execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { root, sleep } from './lib/harness.mjs'
import { DOMAIN, PORT, registerUser, unregisterUser } from './lib/xmpp-daemon.mjs'

const run = promisify(execFile)
const ctl = (...args) => execFileSync(path.join(os.homedir(), '.local/share/moho-dev/xmpp-test.sh'), ['ctl', ...args]).toString()
const caFile = process.env.XMPP_TEST_CA ?? '/1tb/xmpp-test/pki/ca.pem'
const ca = fs.readFileSync(caFile, 'utf8')
const python = process.env.XMPP_PEER_PYTHON ?? '/1tb/xmpp-test/venv/bin/python'

const stamp = Date.now().toString(36)
const me = { name: `pa${stamp}`, password: `pw-${stamp}-a` }
const you = { name: `pb${stamp}`, password: `pw-${stamp}-b` }
for (const p of [me, you]) registerUser(p.name, p.password)
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'moho-xmpp-chat-'))
const accountsFile = path.join(scratch, 'accounts.txt')
fs.writeFileSync(accountsFile, [me, you].map((p) => `${p.name}@${DOMAIN} ${p.password}`).join('\n') + '\n', { mode: 0o600 })
const myJid = `${me.name}@${DOMAIN}`
const yourJid = `${you.name}@${DOMAIN}`
const myId = `xmpp:${myJid}`

const peer = async (who, steps) => {
  const { stdout } = await run(python, [path.join(root, 'scripts/lib/xmpp-peer.py'), who.name, JSON.stringify(steps)], { env: { ...process.env, XMPP_TEST_ACCOUNTS: accountsFile, XMPP_TEST_PORT: String(PORT) }, maxBuffer: 1 << 24 })
  return JSON.parse(stdout)
}

const runtime = path.join(scratch, 'run')
fs.mkdirSync(runtime, { recursive: true, mode: 0o700 })
const env = { ...process.env, HOME: scratch, XDG_CONFIG_HOME: path.join(scratch, 'config'), XDG_DATA_HOME: path.join(scratch, 'data'), XDG_CACHE_HOME: path.join(scratch, 'cache'), XDG_RUNTIME_DIR: runtime }
const daemon = spawn(path.join(root, 'nobilis/target/release/nobilis'), [], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
daemon.stdout.on('data', (d) => (log += d))
daemon.stderr.on('data', (d) => (log += d))
const cleanup = () => {
  try {
    daemon.kill('SIGKILL')
  } catch {
    /* gone */
  }
  for (const p of [me, you]) {
    try {
      unregisterUser(p.name)
    } catch {
      /* already gone */
    }
  }
  fs.rmSync(scratch, { recursive: true, force: true })
}
process.on('exit', cleanup)

const sock = path.join(runtime, 'nobilis', 'nobilis.sock')
for (let i = 0; i < 100 && !fs.existsSync(sock); i++) await sleep(100)
if (!fs.existsSync(sock)) throw new Error('the daemon did not open its socket\n' + log)
const conn = net.connect(sock)
let buf = ''
let nextId = 1
const waiting = new Map()
const events = []
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
const rpc = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    waiting.set(id, (m) => (m.error ? reject(new Error(m.error)) : resolve(m.result)))
    conn.write(JSON.stringify({ id, method, params }) + '\n')
  })
const results = []
const check = (what, ok, detail = '') => {
  results.push(ok)
  console.log(ok ? '  ok  ' : '  FAIL', what, ok ? '' : detail)
}
const until = async (fn, ms = 15000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    const v = await fn()
    if (v) return v
    await sleep(120)
  }
  return null
}
const seen = (event, pred = () => true) => events.find((e) => e.event === event && pred(e.data))
const buffers = async () => rpc('listBuffers')
const buffer = async () => (await buffers()).find((b) => b.accountId === myId && b.remoteId === yourJid)
const backlog = async (b) => rpc('getBacklog', { bufferId: b.id, limit: 100 })
const messageWith = (events_, text) => events_.find((e) => e.event === 'message' && e.data.body === text)?.data

try {
  await rpc('addXmppAccount', { jid: myJid, password: me.password, host: '127.0.0.1', port: PORT, caPem: ca })
  check('the account signs in', await until(async () => (await rpc('listAccounts')).find((a) => a.id === myId)?.state === 'connected'))
  await sleep(800)

  console.log('the roster')
  await rpc('xmppAddContact', { accountId: myId, jid: yourJid, name: 'Bea', group: 'Friends' })
  let theirs = await peer(you, [{ wait_for: 'subscribe', timeout: 8 }, { accept: myJid }, { sleep: 1 }])
  check('a contact is asked to share presence', /type=['"]subscribe['"]/.test(theirs.received), theirs.failed)
  const b = await until(async () => (await buffer()) ?? null)
  check('the contact is a conversation with the name the roster gives it', b?.name === 'Bea' && b?.kind === 'dm', JSON.stringify(b)?.slice(0, 200))
  check('filed under the roster group', b?.category === 'Friends', b?.category)
  // Messages, edits and presence are only pushed for a conversation somebody has open.
  await rpc('subscribe', { bufferId: b.id })

  console.log('presence')
  await peer(you, [{ presence: 'away', status: 'at lunch' }, { sleep: 2 }])
  await sleep(500)
  const present = events.filter((e) => e.event === 'presenceChange' && e.data.bufferId === b.id)
  check('their presence reaches the conversation as it changes', present.length > 0 && present.some((e) => e.data.members.some((m) => m.userId === yourJid && m.status === 'online' || m.status === 'idle')), JSON.stringify(present.at(-1)?.data ?? null))

  console.log('messages in')
  events.length = 0
  theirs = await peer(you, [
    { raw: `<message xmlns='jabber:client' to='${myJid}' type='chat' id='in-1'><body>hello there</body><origin-id xmlns='urn:xmpp:sid:0' id='in-1'/><request xmlns='urn:xmpp:receipts'/><markable xmlns='urn:xmpp:chat-markers:0'/></message>` },
    { wait_for: 'urn:xmpp:receipts', timeout: 8 },
    { sleep: 0.5 }
  ])
  const got = messageWith(events, 'hello there')
  check('a message arrives in its conversation', got?.bufferId === b.id && got?.from === 'Bea' && got?.isOwn === false, JSON.stringify(got)?.slice(0, 200))
  check('and is answered with a receipt', /<received\b(?=[^>]*urn:xmpp:receipts)(?=[^>]*\bid=['"]in-1['"])[^>]*>/.test(theirs.received), theirs.received.slice(-400))
  check('it notifies', !!seen('notification', (d) => d.bufferId === b.id && d.body === 'hello there'))

  console.log('typing')
  events.length = 0
  await peer(you, [{ raw: `<message xmlns='jabber:client' to='${myJid}' type='chat'><composing xmlns='http://jabber.org/protocol/chatstates'/></message>` }, { sleep: 0.6 }])
  check('their typing is shown', !!seen('typing', (d) => d.bufferId === b.id && d.nicks.includes('Bea')))

  console.log('messages out')
  await rpc('sendMessage', { bufferId: b.id, body: 'hi back' })
  // The other client was not signed in, so the server holds it for when it is: what arrives is what was put on the wire.
  const out = await peer(you, [{ wait_for: 'hi back', timeout: 8 }, { sleep: 0.3 }])
  const mine = (await backlog(b)).find((m) => m.body === 'hi back')
  check('a sent message is in the conversation at once, as the account\'s own', mine?.isOwn === true && mine?.senderId === myJid, JSON.stringify(mine))
  const origin = /<origin-id[^>]*id=['"]([^'"]+)['"]/.exec(out.received)?.[1]
  check('it goes out with the id it is stored under, twice, as XEP-0359 asks', !!origin && origin === mine?.id && out.received.includes(`id='${origin}'`) || out.received.includes(`id="${origin}"`), `${origin} ${mine?.id}`)
  check('asking for a receipt, markable, and saying it is active', /urn:xmpp:receipts/.test(out.received) && /chat-markers/.test(out.received) && /chatstates/.test(out.received), out.received.slice(-500))

  console.log('spoilers')
  events.length = 0
  await peer(you, [
    { raw: `<message xmlns='jabber:client' to='${myJid}' type='chat' id='sp-1'><body>the ship sinks</body><origin-id xmlns='urn:xmpp:sid:0' id='sp-1'/><spoiler xmlns='urn:xmpp:spoiler:0'>film ending</spoiler></message>` },
    { sleep: 0.8 }
  ])
  check('a message that is a spoiler is drawn hidden, with its hint in the open', !!messageWith(events, 'film ending: ||the ship sinks||'), JSON.stringify(events.filter((e) => e.event === 'message').map((e) => e.data.body)))
  await rpc('sendMessage', { bufferId: b.id, body: '||he was the killer||' })
  const hid = await peer(you, [{ wait_for: 'the killer', timeout: 8 }, { sleep: 0.3 }])
  check('what is typed wholly between bars is sent as a spoiler, without the bars', /<spoiler[^>]*urn:xmpp:spoiler:0/.test(hid.received) && /<body>he was the killer<\/body>/.test(hid.received), hid.received.slice(-500))

  console.log('what the other side does to its own messages')
  events.length = 0
  await peer(you, [
    { raw: `<message xmlns='jabber:client' to='${myJid}' type='chat' id='in-2'><body>teh answer</body><origin-id xmlns='urn:xmpp:sid:0' id='in-2'/></message>` },
    { sleep: 0.8 },
    { raw: `<message xmlns='jabber:client' to='${myJid}' type='chat' id='in-3'><body>the answer</body><origin-id xmlns='urn:xmpp:sid:0' id='in-3'/><replace xmlns='urn:xmpp:message-correct:0' id='in-2'/></message>` },
    { sleep: 0.8 }
  ])
  const fixed = seen('messageUpdated', (d) => d.body === 'the answer')
  check('a correction replaces the text of the message it names', !!fixed && fixed.data.id === 'in-2' && fixed.data.edited === true, JSON.stringify(fixed?.data))
  check('and is not a message of its own', !messageWith(events, 'the answer'))
  await peer(you, [
    { raw: `<message xmlns='jabber:client' to='${myJid}' type='chat' id='x'><body>fallback</body><retract xmlns='urn:xmpp:message-retract:1' id='in-2'/><fallback xmlns='urn:xmpp:fallback:0' for='urn:xmpp:message-retract:1'/></message>` },
    { sleep: 0.8 }
  ])
  check('a retraction removes the message', !!seen('messageDeleted', (d) => d.id === 'in-2'))
  events.length = 0
  await peer(you, [
    { raw: `<message xmlns='jabber:client' to='${myJid}' type='chat' id='in-4'><body>react to me</body><origin-id xmlns='urn:xmpp:sid:0' id='in-4'/></message>` },
    { sleep: 0.5 },
    { raw: `<message xmlns='jabber:client' to='${myJid}' type='chat'><reactions xmlns='urn:xmpp:reactions:0' id='in-4'><reaction>👍</reaction><reaction>🎉</reaction></reactions><store xmlns='urn:xmpp:hints'/></message>` },
    { sleep: 0.5 },
    { raw: `<message xmlns='jabber:client' to='${myJid}' type='chat'><reactions xmlns='urn:xmpp:reactions:0' id='in-4'><reaction>👍</reaction></reactions><store xmlns='urn:xmpp:hints'/></message>` },
    { sleep: 0.8 }
  ])
  const reacted = events.filter((e) => e.event === 'reactionsChanged' && e.data.id === 'in-4')
  check('reactions arrive, and a reaction set that drops one takes it away', reacted.length >= 2 && JSON.stringify(reacted.at(-1).data.reactions).includes('👍') && !JSON.stringify(reacted.at(-1).data.reactions).includes('🎉'), JSON.stringify(reacted.map((e) => e.data.reactions)))
  events.length = 0
  await peer(you, [
    { raw: `<message xmlns='jabber:client' to='${myJid}' type='chat' id='in-5'><body>> Bea\n> react to me\nI agree</body><origin-id xmlns='urn:xmpp:sid:0' id='in-5'/><reply xmlns='urn:xmpp:reply:0' id='in-4' to='${yourJid}'/><fallback xmlns='urn:xmpp:fallback:0' for='urn:xmpp:reply:0'><body start='0' end='20'/></fallback></message>` },
    { sleep: 0.8 }
  ])
  const reply = messageWith(events, 'I agree')
  check('a reply is drawn as one, without its quoted fallback in the text', reply?.replyTo?.id === 'in-4' && reply?.replyTo?.body === 'react to me', JSON.stringify(reply)?.slice(0, 300))

  console.log('what moho does to its own')
  const sent = (await backlog(b)).find((m) => m.body === 'hi back')
  await rpc('editMessage', { bufferId: b.id, messageId: sent.id, body: 'hi again' })
  await rpc('toggleReaction', { bufferId: b.id, messageId: 'in-1', emoji: '❤️', add: true })
  await rpc('sendMessage', { bufferId: b.id, body: 'a reply', replyToId: 'in-1' })
  await rpc('deleteMessage', { bufferId: b.id, messageId: sent.id })
  const wire = await peer(you, [{ wait_for: 'a reply', timeout: 8 }, { wait_for: 'message-retract', timeout: 8 }, { sleep: 0.3 }])
  check('an edit goes out as a correction naming the message', new RegExp(`urn:xmpp:message-correct:0['"][^>]*id=['"]${sent.id}['"]|id=['"]${sent.id}['"][^>]*message-correct`).test(wire.received) || (wire.received.includes('message-correct') && wire.received.includes('hi again')), wire.received.slice(-700))
  check('a reaction goes out as the whole set', /<reactions\b(?=[^>]*urn:xmpp:reactions:0)(?=[^>]*\bid=['"]in-1['"])[^>]*>/.test(wire.received) && wire.received.includes('❤'), wire.received.slice(-500))
  check('a reply goes out naming its target, with the quoted text as fallback', /<reply[^>]*in-1/.test(wire.received) && /urn:xmpp:fallback:0/.test(wire.received) && wire.received.includes('&gt; Bea'), wire.received.slice(-600))
  check('a deletion goes out as a retraction', wire.received.includes('message-retract') && wire.received.includes(sent.id), wire.received.slice(-400))
  const bl = await backlog(b)
  check('a deleted message is gone here too', !bl.some((m) => m.id === sent.id))
  check('a reply carries what it answers', bl.find((m) => m.body === 'a reply')?.replyTo?.id === 'in-1', JSON.stringify(bl.find((m) => m.body === 'a reply')))

  console.log('another device of the same account')
  events.length = 0
  await peer(me, [{ raw: `<message xmlns='jabber:client' to='${yourJid}' type='chat' id='dev-1'><body>from my phone</body><origin-id xmlns='urn:xmpp:sid:0' id='dev-1'/></message>` }, { sleep: 1 }])
  const carbon = messageWith(events, 'from my phone')
  check('a message sent from another device is in the conversation, as the account\'s own', carbon?.bufferId === b.id && carbon?.isOwn === true, JSON.stringify(carbon)?.slice(0, 200))

  console.log('away, and what the archive brings back')
  await rpc('setAccountConnected', { accountId: myId, connected: false })
  await until(async () => (await rpc('listAccounts')).find((a) => a.id === myId)?.state === 'disconnected')
  await peer(you, [{ raw: `<message xmlns='jabber:client' to='${myJid}' type='chat' id='away-1'><body>while you were out</body><origin-id xmlns='urn:xmpp:sid:0' id='away-1'/></message>` }, { sleep: 1 }])
  events.length = 0
  await rpc('setAccountConnected', { accountId: myId, connected: true })
  await until(async () => (await rpc('listAccounts')).find((a) => a.id === myId)?.state === 'connected')
  await until(async () => (await backlog(b)).some((m) => m.body === 'while you were out'), 15000)
  const bl2 = await backlog(b)
  check('what was said while away is there after connecting', bl2.some((m) => m.body === 'while you were out'))
  const dup = (text) => bl2.filter((m) => m.body === text).length
  check('and nothing that was already held is held twice', dup('hello there') === 1 && dup('I agree') === 1 && dup('while you were out') === 1 && dup('from my phone') === 1, JSON.stringify(['hello there', 'I agree', 'while you were out', 'from my phone'].map(dup)))
  check('catching up does not notify for what is old', !seen('notification', (d) => d.body === 'hello there'))

  console.log('what is read on one device')
  await rpc('markBufferRead', { bufferId: b.id })
  await sleep(1200)
  const items = await peer(me, [{ raw: `<iq xmlns='jabber:client' type='get' id='mds1'><pubsub xmlns='http://jabber.org/protocol/pubsub'><items node='urn:xmpp:mds:displayed:0'/></pubsub></iq>` }, { wait_for: 'mds1', timeout: 6 }])
  const stanza = /<stanza-id[^>]*id=['"]([^'"]+)['"]/.exec(items.received.slice(items.received.indexOf("id='mds1'")))?.[1]
  check('reading a conversation tells the account\'s other devices up to which message', !!stanza && items.received.includes(yourJid), items.received.slice(-400))
  events.length = 0
  await peer(me, [{ raw: `<iq xmlns='jabber:client' type='set' id='mds2'><pubsub xmlns='http://jabber.org/protocol/pubsub'><publish node='urn:xmpp:mds:displayed:0'><item id='${yourJid}'><displayed xmlns='urn:xmpp:mds:displayed:0'><stanza-id xmlns='urn:xmpp:sid:0' by='${myJid}' id='${stanza}'/></displayed></item></publish></pubsub></iq>` }, { sleep: 1.5 }])
  check('and when another device reads, it is read here', events.some((e) => e.event === 'bufferRead' && e.data.bufferId === b.id), JSON.stringify(events.map((e) => e.event)))
} catch (err) {
  console.log('  FAIL', err.message)
  results.push(false)
  console.log(log.split('\n').filter((l) => /xmpp|WARN|ERROR/.test(l)).slice(-30).map((l) => l.slice(0, 300)).join('\n'))
} finally {
  cleanup()
}
await sleep(200)
const ok = results.every(Boolean)
console.log(ok ? 'ALL OK' : 'FAILED')
process.exit(ok ? 0 : 1)
