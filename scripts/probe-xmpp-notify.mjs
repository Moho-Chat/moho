#!/usr/bin/env node
/**
 * How much a room may interrupt, kept where every client of the account reads it: in the room's bookmark (XEP-0492 inside
 * XEP-0402). Another client of the same account (slixmpp, signed in as the same person on another device) reads what moho
 * set and sets it in turn; what it keeps in the bookmark that moho does not know is left alone, a rejoin included.
 *
 *   node scripts/probe-xmpp-notify.mjs        (ejabberd)        XMPP_TEST_SERVER=prosody node scripts/probe-xmpp-notify.mjs
 */
import { start, sleep, CONF } from './lib/xmpp-daemon.mjs'

const t = await start({ people: 1 })
const [me] = t.accounts
const myId = t.accountId(me)
const room = `notify${t.stamp}@${CONF}`
const bookmarks = (id) => ({ raw: `<iq xmlns='jabber:client' type='get' id='${id}'><pubsub xmlns='http://jabber.org/protocol/pubsub'><items node='urn:xmpp:bookmarks:1'/></pubsub></iq>` })
const answerTo = (received, id) => received.slice(received.indexOf(`id='${id}'`), received.indexOf('</iq>', received.indexOf(`id='${id}'`)))
const levelOf = async (bufferId) => (await t.rpc('listBuffers')).find((b) => b.id === bufferId)?.notify
try {
  t.check('it signs in', !!(await t.signIn(me)))
  const r = await t.rpc('xmppJoinRoom', { accountId: myId, jid: room, nick: 'mohonick' })
  t.check('a room is joined and bookmarked', !!r.bufferId)
  await sleep(1000)

  console.log('set here, read by the other client')
  await t.rpc('setNotifyLevel', { bufferId: r.bufferId, level: 'mentions' })
  t.check('the conversation shows it', (await levelOf(r.bufferId)) === 'mentions', await levelOf(r.bufferId))
  let seen = await t.peer(me, [bookmarks('b1'), { wait_for: "id='b1'", timeout: 8 }, { sleep: 0.5 }])
  let answer = answerTo(seen.received, 'b1')
  t.check("the bookmark says on-mention, in XEP-0492's words", /<notify xmlns=['"]urn:xmpp:notification-settings:1['"]><on-mention\/><\/notify>/.test(answer), answer.slice(0, 600))

  console.log('set by the other client, read here')
  const conference = `<conference xmlns='urn:xmpp:bookmarks:1' autojoin='true'><nick>mohonick</nick><extensions><pinned xmlns='urn:example:other-client'/><notify xmlns='urn:xmpp:notification-settings:1'><always identity-category='client' identity-type='phone'/><never/></notify></extensions></conference>`
  await t.peer(me, [
    { raw: `<iq xmlns='jabber:client' type='set' id='p1'><pubsub xmlns='http://jabber.org/protocol/pubsub'><publish node='urn:xmpp:bookmarks:1'><item id='${room}'>${conference}</item></publish><publish-options><x xmlns='jabber:x:data' type='submit'><field var='FORM_TYPE' type='hidden'><value>http://jabber.org/protocol/pubsub#publish-options</value></field><field var='pubsub#persist_items'><value>true</value></field><field var='pubsub#access_model'><value>whitelist</value></field><field var='pubsub#max_items'><value>max</value></field><field var='pubsub#send_last_published_item'><value>never</value></field></x></publish-options></pubsub></iq>` },
    { wait_for: "id='p1'", timeout: 8 },
    { sleep: 1.5 }
  ])
  t.check('the conversation follows it (mute: a phone setting is not ours)', !!(await t.until(async () => (await levelOf(r.bufferId)) === 'mute', 8000)), await levelOf(r.bufferId))

  console.log('what moho does not know is kept')
  await t.rpc('setNotifyLevel', { bufferId: r.bufferId, level: 'all' })
  await t.rpc('xmppJoinRoom', { accountId: myId, jid: room, nick: 'mohonick' })
  await sleep(1000)
  seen = await t.peer(me, [bookmarks('b2'), { wait_for: "id='b2'", timeout: 8 }, { sleep: 0.5 }])
  answer = answerTo(seen.received, 'b2')
  t.check("the other client's extension and its phone setting survive a change of level and a rejoin", /urn:example:other-client/.test(answer) && /identity-type=['"]phone['"]/.test(answer) && /<always\/>/.test(answer), answer.slice(0, 700))
  await t.rpc('setNotifyLevel', { bufferId: r.bufferId, level: 'default' })
  seen = await t.peer(me, [bookmarks('b3'), { wait_for: "id='b3'", timeout: 8 }, { sleep: 0.5 }])
  answer = answerTo(seen.received, 'b3')
  t.check('back to default takes our setting away and leaves the phone one', !/<always\/>/.test(answer) && !/<never\/>/.test(answer) && /identity-type=['"]phone['"]/.test(answer), answer.slice(0, 700))
} catch (err) {
  t.failed(err)
} finally {
  await t.finish()
}
