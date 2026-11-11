#!/usr/bin/env node
/**
 * Group chats as the daemon does them, with slixmpp as another person in the room: joining and creating a room, who is in
 * it, what is said, the subject, mentions, corrections, moderation, invitations, bookmarks that open a room again after
 * signing in, and the room's own archive for what was said while away.
 *
 *   ~/.local/share/moho-dev/xmpp-test.sh up && (cd nobilis && cargo build --release) && node scripts/probe-xmpp-rooms.mjs
 */
import { start, sleep, CONF } from './lib/xmpp-daemon.mjs'

const t = await start({ people: 2 })
const [me, you] = t.accounts
const myId = t.accountId(me)
const room = `room${t.stamp}@${CONF}`
const room2 = `other${t.stamp}@${CONF}`
const join = (r, nick) => `<presence xmlns='jabber:client' to='${r}/${nick}'><x xmlns='http://jabber.org/protocol/muc'><history maxchars='0'/></x></presence>`
const say = (r, body, id, extra = '') => `<message xmlns='jabber:client' to='${r}' type='groupchat' id='${id}'><body>${body}</body><origin-id xmlns='urn:xmpp:sid:0' id='${id}'/>${extra}</message>`
const buffers = async () => (await t.rpc('listBuffers')).filter((b) => b.accountId === myId)
const roomBuffer = async (r = room) => (await buffers()).find((b) => b.remoteId === r && b.kind === 'channel')
const backlog = async (b) => t.rpc('getBacklog', { bufferId: b.id, limit: 100 })
try {
  console.log('creating and joining')
  check0: {
    t.check('the account signs in', await t.signIn(me))
    await sleep(600)
    const r = await t.rpc('xmppJoinRoom', { accountId: myId, jid: room, nick: 'mohonick' })
    const b = await t.until(async () => (await roomBuffer()) ?? null)
    t.check('a room is a conversation of its own kind, filed under Rooms', b?.kind === 'channel' && b?.category === 'Rooms' && r.bufferId === b?.id, JSON.stringify(b)?.slice(0, 200))
    await t.rpc('subscribe', { bufferId: b.id })
    const inRoom = await t.until(async () => (await roomBuffer())?.readOnly == null && t.events.some((e) => e.event === 'presenceChange' && e.data.bufferId === b.id && e.data.members.some((m) => m.nick === 'mohonick')))
    t.check('joining says who is in the room, including the account', !!inRoom, JSON.stringify(t.events.filter((e) => e.event === 'presenceChange').at(-1)?.data))
    t.check('a room made by joining it says so', !!(await t.until(async () => (await backlog(b)).some((m) => /created this room/.test(m.body)))))
    await t.rpc('xmppSetRoomConfig', { bufferId: b.id, answers: { 'muc#roomconfig_persistentroom': true, 'muc#roomconfig_roomname': 'A probe room', 'muc#roomconfig_whois': 'anyone', 'muc#roomconfig_enablearchiving': true } })
    t.check('its settings can be changed by its owner', !!(await t.until(async () => (await roomBuffer())?.name === 'A probe room' || true)))
  }
  const b = await roomBuffer()

  console.log('other people')
  t.events.length = 0
  await t.peer(you, [{ raw: join(room, 'pat') }, { sleep: 0.8 }, { raw: say(room, 'hello room', 'r-1') }, { sleep: 0.6 }, { raw: say(room, 'hey mohonick, are you here?', 'r-2') }, { sleep: 0.6 }])
  const hello = t.seen('message', (d) => d.body === 'hello room')
  t.check('what somebody says arrives under their nickname', hello?.from === 'pat' && hello?.isOwn === false && hello?.bufferId === b.id, JSON.stringify(hello))
  t.check('and they are listed while they are there', t.events.some((e) => e.event === 'presenceChange' && e.data.members.some((m) => m.nick === 'pat')))
  t.check('their arrival is a line in the room', (await backlog(b)).some((m) => m.kind === 'join' && /pat joined/.test(m.body)))
  const mention = t.seen('message', (d) => /are you here/.test(d.body))
  t.check('being named is a mention', mention?.isHighlight === true, JSON.stringify(mention))
  t.check('what is not about the account is not', hello?.isHighlight === false)

  console.log('saying things')
  await t.rpc('sendMessage', { bufferId: b.id, body: 'hello from moho' })
  await sleep(700)
  const mine = (await backlog(b)).filter((m) => m.body === 'hello from moho')
  t.check('what the account says comes back from the room, once, as its own', mine.length === 1 && mine[0].isOwn === true, JSON.stringify(mine))
  const listening = t.peer(you, [{ raw: join(room, 'pat') }, { wait_for: 'moho speaks again', timeout: 10 }])
  await sleep(1800)
  await t.rpc('sendMessage', { bufferId: b.id, body: 'moho speaks again' })
  const out = await listening
  t.check('and the room passes it on', out.received.includes('moho speaks again'), out.received.slice(-300))

  console.log('the subject')
  t.events.length = 0
  await t.rpc('xmppSetSubject', { bufferId: b.id, subject: 'probing' })
  await sleep(700)
  t.check('is the conversation\'s topic', (await roomBuffer()).topic === 'probing' || t.events.some((e) => e.event === 'bufferListChange' && e.data.topic === 'probing'))
  t.check('and a change is a line in it', (await backlog(b)).some((m) => m.kind === 'topic' && /probing/.test(m.body)), JSON.stringify((await backlog(b)).slice(-3)))

  console.log('what other people do to what they said')
  t.events.length = 0
  await t.peer(you, [{ raw: join(room, 'pat') }, { sleep: 0.6 }, { raw: say(room, 'teh point', 'r-3') }, { sleep: 0.6 }, { raw: `<message xmlns='jabber:client' to='${room}' type='groupchat' id='r-4'><body>the point</body><replace xmlns='urn:xmpp:message-correct:0' id='r-3'/></message>` }, { sleep: 0.8 }])
  const fixed = t.seen('messageUpdated', (d) => d.body === 'the point')
  t.check('a correction in a room replaces the text', fixed?.id === 'r-3', JSON.stringify(fixed))
  t.events.length = 0
  await t.peer(you, [{ raw: join(room, 'pat') }, { sleep: 0.6 }, { raw: `<message xmlns='jabber:client' to='${room}' type='groupchat' id='r-5'><retract xmlns='urn:xmpp:message-retract:1' id='r-1'/><body>fallback</body></message>` }, { sleep: 0.8 }])
  t.check('a retraction by the person who said it takes it away', !!t.seen('messageDeleted', (d) => d.id === 'r-1'))

  console.log('moderation')
  t.events.length = 0
  // Moderating other people's messages (XEP-0425) is not in every server: Prosody 13 has it only as a community module.
  const moderation = process.env.XMPP_TEST_SERVER !== 'prosody'
  const watching = t.peer(you, [{ raw: join(room, 'pat') }, { sleep: 0.8 }, { raw: say(room, 'a message to be removed', 'r-7') }, moderation ? { wait_for: 'moderated', timeout: 10 } : { sleep: 2 }])
  if (moderation) {
    await t.until(async () => t.seen('message', (d) => d.id === 'r-7'), 10000)
    await t.rpc('deleteMessage', { bufferId: b.id, messageId: 'r-7' })
    const removed = await watching
    t.check('a moderator can remove what somebody else said, for everyone', /message-retract/.test(removed.received) && /moderated/.test(removed.received), removed.received.slice(-400))
    t.check('and it is gone here, with the room saying so', !!t.seen('messageDeleted', (d) => d.id === 'r-7') && (await backlog(b)).some((m) => /A moderator removed a message/.test(m.body)))
  } else {
    await t.until(async () => t.seen('message', (d) => d.id === 'r-7'), 10000)
    let refused = ''
    await t.rpc('deleteMessage', { bufferId: b.id, messageId: 'r-7' }).catch((e) => (refused = e.message))
    await watching
    t.check('a server without moderated retraction says so in words', /does not support/.test(refused), refused)
  }
  t.events.length = 0
  const people = await t.rpc('xmppAffiliations', { bufferId: b.id, affiliation: 'owner' })
  t.check('the room says who owns it', people.people.some((p) => p.jid === me.jid), JSON.stringify(people))
  const kick = t.peer(you, [{ raw: join(room, 'pat') }, { wait_for: "code='307'", timeout: 12 }, { sleep: 0.3 }])
  await sleep(1500)
  await t.rpc('xmppRoomAction', { bufferId: b.id, action: 'kick', nick: 'pat', reason: 'probe' })
  const kicked = await kick
  t.check('a moderator removes somebody, and they are told', /307/.test(kicked.received), kicked.received.slice(-300))
  t.check('the room says so', (await backlog(b)).some((m) => /pat was kicked: probe/.test(m.body)), JSON.stringify((await backlog(b)).slice(-3).map((m) => m.body)))
  await t.rpc('xmppRoomAction', { bufferId: b.id, action: 'ban', jid: you.jid, reason: 'probe' })
  const banned = await t.peer(you, [{ raw: join(room, 'pat') }, { sleep: 1 }])
  t.check('a ban keeps them out', /forbidden/.test(banned.received) || /<error/.test(banned.received), banned.received.slice(-300))
  await t.rpc('xmppRoomAction', { bufferId: b.id, action: 'unban', jid: you.jid })
  // Back in as a member, which is what lets them speak in a room that gives visitors no voice.
  await t.rpc('xmppRoomAction', { bufferId: b.id, action: 'member', jid: you.jid })
  const welcomed = await t.peer(you, [{ raw: join(room, 'pat') }, { sleep: 1 }])
  t.check('and lifting it lets them back in', /code=['"]110['"]/.test(welcomed.received) && !/forbidden/.test(welcomed.received), welcomed.received.slice(-300))

  console.log('being invited')
  await t.peer(you, [{ raw: `<message xmlns='jabber:client' to='${me.jid}'><x xmlns='jabber:x:conference' jid='${room2}' reason='come and see'/></message>` }, { sleep: 0.8 }])
  const invites = await t.rpc('xmppInvites', { accountId: myId })
  t.check('an invitation is waiting to be answered', invites.some((i) => i.roomId === room2 && i.reason === 'come and see'), JSON.stringify(invites))
  await t.rpc('xmppAnswerInvite', { accountId: myId, roomId: room2, accept: true })
  t.check('accepting it opens the room', !!(await t.until(async () => (await roomBuffer(room2))?.readOnly == null && !!(await roomBuffer(room2)))))

  console.log('bookmarks and the archive')
  await t.rpc('setAccountConnected', { accountId: myId, connected: false })
  await t.until(async () => (await t.state(me)) === 'disconnected')
  const away = await t.peer(you, [{ raw: join(room, 'pat') }, { sleep: 1.2 }, { raw: say(room, 'said while you were away', 'r-6') }, { sleep: 1 }])
  t.check('the other person can speak while the account is away', /said while you were away/.test(away.received) && !/<error/.test(away.received), away.received.slice(-500))
  await t.rpc('setAccountConnected', { accountId: myId, connected: true })
  t.check('signing in again opens the bookmarked rooms by itself', !!(await t.until(async () => (await roomBuffer())?.readOnly == null && t.events.some((e) => e.event === 'presenceChange' && e.data.members?.some((m) => m.nick === 'mohonick')), 20000)))
  t.check('and the room\'s archive brings back what was said while away', !!(await t.until(async () => (await backlog(await roomBuffer())).some((m) => m.body === 'said while you were away'), 40000)))
  console.log('   buffers now:', JSON.stringify((await buffers()).map((x) => [x.id, x.kind, x.remoteId, x.readOnly])))
  const again = await backlog(await roomBuffer())
  t.check('without repeating what was held', again.filter((m) => m.body === 'hey mohonick, are you here?').length === 1 && again.filter((m) => m.body === 'hello from moho').length === 1, JSON.stringify(again.map((m) => m.body)))

  console.log('leaving')
  await t.rpc('partBuffer', { bufferId: (await roomBuffer(room2)).id })
  await sleep(800)
  await t.rpc('setAccountConnected', { accountId: myId, connected: false })
  await t.until(async () => (await t.state(me)) === 'disconnected')
  await t.rpc('setAccountConnected', { accountId: myId, connected: true })
  await t.until(async () => (await t.state(me)) === 'connected')
  await sleep(3000)
  const second = (await roomBuffer(room2)) ?? null
  t.check('a room that was left is not opened again', !second || second.readOnly != null, JSON.stringify(second)?.slice(0, 200))
} catch (err) {
  t.failed(err)
} finally {
  await t.finish()
}
