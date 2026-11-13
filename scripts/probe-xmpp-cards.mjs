#!/usr/bin/env node
/**
 * What the protocol says - as opposed to what somebody says - is a card (ARCHITECTURE: "Notifications are cards"): somebody's
 * standing in a room changing, a room's settings changing, an invitation declined, a room closed, a contact accepting and
 * then stopping sharing their presence, and (on ejabberd, which can be told to send one) an announcement from the server.
 *
 *   node scripts/probe-xmpp-cards.mjs        (ejabberd)        XMPP_TEST_SERVER=prosody node scripts/probe-xmpp-cards.mjs
 */
import { start, sleep, CONF, SERVER, DOMAIN, ctl } from './lib/xmpp-daemon.mjs'

const t = await start({ people: 2 })
const [me, you] = t.accounts
const myId = t.accountId(me)
const room = `cards${t.stamp}@${CONF}`
const join = `<presence xmlns='jabber:client' to='${room}/pat'><x xmlns='http://jabber.org/protocol/muc'/></presence>`
const backlog = async (bufferId) => ((await t.rpc('getBacklog', { bufferId, limit: 100 })) ?? []).map((m) => ({ kind: m.kind, body: m.body }))
const card = async (bufferId, re, ms = 8000) => t.until(async () => (await backlog(bufferId)).find((m) => m.kind !== 'chat' && re.test(m.body)), ms)
try {
  t.check('it signs in', !!(await t.signIn(me)))
  const r = await t.rpc('xmppJoinRoom', { accountId: myId, jid: room, nick: 'mohonick', bookmark: false })
  await sleep(1500)

  console.log('in a room')
  const staying = t.peer(you, [{ raw: join }, { sleep: 12 }])
  await sleep(2000)
  await t.rpc('xmppRoomAction', { bufferId: r.bufferId, action: 'moderator', nick: 'pat' })
  const mod = await card(r.bufferId, /pat is now a moderator/)
  t.check('somebody made a moderator is a card', mod?.kind === 'mode', JSON.stringify(mod))
  await t.rpc('xmppRoomAction', { bufferId: r.bufferId, action: 'voice', nick: 'pat' })
  t.check('and losing it is one too', !!(await card(r.bufferId, /pat is no longer a moderator/)))
  await t.rpc('xmppSetRoomConfig', { bufferId: r.bufferId, answers: { 'muc#roomconfig_whois': 'anyone' } })
  t.check("a change to the room's settings is said", !!(await card(r.bufferId, /room's settings were changed|shows everyone's address/)), JSON.stringify((await backlog(r.bufferId)).slice(-3)))
  await staying

  await t.rpc('xmppInvite', { bufferId: r.bufferId, jid: you.jid, reason: 'come in' })
  await t.peer(you, [{ sleep: 1 }, { raw: `<message xmlns='jabber:client' to='${room}'><x xmlns='http://jabber.org/protocol/muc#user'><decline to='${me.jid}'><reason>busy now</reason></decline></x></message>` }, { sleep: 1.5 }])
  t.check('an invitation declined is a card', !!(await card(r.bufferId, /declined your invitation: busy now/)), JSON.stringify((await backlog(r.bufferId)).slice(-3)))

  await t.rpc('xmppDestroyRoom', { bufferId: r.bufferId, reason: 'probe is done' })
  const closed = await card(r.bufferId, /The room was closed: probe is done/)
  t.check('a room closed by its owner says so, and why', !!closed, JSON.stringify((await backlog(r.bufferId)).slice(-3)))

  console.log('with a contact')
  await t.rpc('xmppAddContact', { accountId: myId, jid: you.jid, name: 'Bea' })
  await t.peer(you, [{ wait_for: 'subscribe', timeout: 8 }, { accept: me.jid }, { sleep: 1.5 }])
  const b = await t.until(async () => (await t.rpc('listBuffers')).find((x) => x.accountId === myId && x.remoteId === you.jid) ?? null)
  t.check('their accepting is a card', !!(await card(b.id, /accepted: you see when they are online/)), JSON.stringify(await backlog(b.id)))
  await t.peer(you, [{ raw: `<presence xmlns='jabber:client' to='${me.jid}' type='unsubscribed'/>` }, { sleep: 1.5 }])
  t.check('and their stopping is one', !!(await card(b.id, /stopped sharing when they are online/)), JSON.stringify(await backlog(b.id)))

  if (SERVER !== 'prosody') {
    console.log('from the server itself')
    ctl('send_message', 'headline', DOMAIN, me.jid, 'Maintenance', 'The server restarts at noon')
    const server = await t.until(async () => (await t.rpc('listBuffers')).find((x) => x.accountId === myId && x.remoteId === DOMAIN) ?? null, 8000)
    const notice = server && (await card(server.id, /restarts at noon/))
    t.check('an announcement is a card, not somebody speaking', notice?.kind === 'system', JSON.stringify(server ? await backlog(server.id) : null))
  }
} catch (err) {
  t.failed(err)
} finally {
  await t.finish()
}
