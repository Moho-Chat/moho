#!/usr/bin/env node
/**
 * Who people say they are, both ways, with another client (slixmpp):
 *
 * - what a contact publishes - a tune (XEP-0118), a mood (XEP-0107), an activity (XEP-0108), a place (XEP-0080), a nickname
 *   (XEP-0172) - reaches this client (its capabilities say +notify), shows in the member list, and is on their card with
 *   their vCard (XEP-0054); their place in words and never their coordinates;
 * - this account's own name, nickname, e-mail, website and words about itself are published (vCard4, XEP-0292; vcard-temp;
 *   the nickname node) and the other client reads them back from each.
 *
 *   node scripts/probe-xmpp-profile.mjs        (ejabberd)        XMPP_TEST_SERVER=prosody node scripts/probe-xmpp-profile.mjs
 */
import { start, sleep } from './lib/xmpp-daemon.mjs'

const t = await start({ people: 2 })
const [me, you] = t.accounts
const myId = t.accountId(me)
const pub = (id, node, payload) => ({ raw: `<iq xmlns='jabber:client' type='set' id='${id}'><pubsub xmlns='http://jabber.org/protocol/pubsub'><publish node='${node}'><item>${payload}</item></publish></pubsub></iq>` })
try {
  t.check('it signs in', !!(await t.signIn(me)))
  await t.rpc('xmppAddContact', { accountId: myId, jid: you.jid, name: '' })
  await t.peer(you, [{ wait_for: 'subscribe', timeout: 8 }, { accept: me.jid }, { roster_add: me.jid, name: 'Me' }, { sleep: 2 }])
  const b = await t.until(async () => (await t.rpc('listBuffers')).find((x) => x.accountId === myId && x.remoteId === you.jid) ?? null)
  t.check('the contact is a conversation', !!b)
  await t.rpc('subscribe', { bufferId: b.id })

  console.log('what a contact publishes')
  await t.peer(you, [
    { raw: `<iq xmlns='jabber:client' type='set' id='vc'><vCard xmlns='vcard-temp'><FN>Bea Example</FN><EMAIL><INTERNET/><USERID>bea@example.org</USERID></EMAIL><URL>https://bea.example.org/</URL><DESC>Writes things.</DESC><ADR><LOCALITY>Lisbon</LOCALITY><CTRY>Portugal</CTRY></ADR></vCard></iq>` },
    pub('n', 'http://jabber.org/protocol/nick', "<nick xmlns='http://jabber.org/protocol/nick'>bea</nick>"),
    pub('m', 'http://jabber.org/protocol/mood', "<mood xmlns='http://jabber.org/protocol/mood'><happy/><text>sunny day</text></mood>"),
    pub('a', 'http://jabber.org/protocol/activity', "<activity xmlns='http://jabber.org/protocol/activity'><relaxing><reading/></relaxing></activity>"),
    pub('g', 'http://jabber.org/protocol/geoloc', "<geoloc xmlns='http://jabber.org/protocol/geoloc'><lat>38.72</lat><lon>-9.14</lon><locality>Lisbon</locality><country>Portugal</country></geoloc>"),
    pub('t', 'http://jabber.org/protocol/tune', "<tune xmlns='http://jabber.org/protocol/tune'><artist>Yes</artist><title>Roundabout</title></tune>"),
    { sleep: 2 }
  ])
  const listed = await t.until(async () => t.events.filter((e) => e.event === 'presenceChange' && e.data?.bufferId === b.id).map((e) => e.data.members.find((m) => m.userId === you.jid)).find((m) => m?.activity?.kind === 'music'), 10000)
  t.check('the tune they play shows in the member list', listed?.activity?.text === 'Yes – Roundabout', JSON.stringify(listed))
  t.check('under the nickname they publish, since the roster has no name for them', listed?.nick === 'bea', listed?.nick)
  const asked = await t.rpc('requestProfile', { bufferId: b.id, nick: you.jid, userId: you.jid })
  t.check('a card is opened at once', asked?.pending === true)
  const card = (await t.until(async () => t.events.find((e) => e.event === 'profile' && e.data?.handle === you.jid && !e.data?.pending), 10000))?.data
  const extra = Object.fromEntries((card?.extra ?? []).map((x) => [x.label, x.value]))
  t.check('their card has the name from their vCard', card?.name === 'Bea Example', card?.name)
  t.check('and its fields', extra['E-mail'] === 'bea@example.org' && extra.Website === 'https://bea.example.org/' && extra.About === 'Writes things.' && extra['Lives in'] === 'Lisbon, Portugal', JSON.stringify(extra))
  t.check('their mood, what they are doing and what they are listening to', /happy - sunny day/.test(extra.Mood ?? '') && /relaxing \(reading\)/.test(extra.Doing ?? '') && extra['Listening to'] === 'Yes – Roundabout', JSON.stringify(extra))
  t.check('where they are, in words and without their coordinates', extra.Where === 'Lisbon, Portugal' && !JSON.stringify(card).includes('38.72'), extra.Where)
  t.check('and the nickname they go by', extra['Calls themselves'] === 'bea', JSON.stringify(extra))
  await t.peer(you, [pub('t2', 'http://jabber.org/protocol/tune', "<tune xmlns='http://jabber.org/protocol/tune'/>"), { sleep: 1.5 }])
  const stopped = await t.until(async () => t.events.filter((e) => e.event === 'presenceChange' && e.data?.bufferId === b.id).map((e) => e.data.members.find((m) => m.userId === you.jid)).pop(), 5000)
  t.check('when the music stops, their mood shows instead', /Feeling happy/.test(stopped?.activity?.text ?? ''), JSON.stringify(stopped?.activity))

  console.log("this account's own profile")
  const mine = { fullName: 'Moho Probe', nickname: 'probey', email: 'probe@example.org', url: 'https://moho.example/', note: 'Testing, testing.' }
  await t.rpc('xmppSetProfile', { accountId: myId, ...mine })
  const read = await t.peer(you, [
    { raw: `<iq xmlns='jabber:client' type='get' id='r1' to='${me.jid}'><vCard xmlns='vcard-temp'/></iq>` },
    { raw: `<iq xmlns='jabber:client' type='get' id='r2' to='${me.jid}'><pubsub xmlns='http://jabber.org/protocol/pubsub'><items node='urn:xmpp:vcard4'/></pubsub></iq>` },
    { raw: `<iq xmlns='jabber:client' type='get' id='r3' to='${me.jid}'><pubsub xmlns='http://jabber.org/protocol/pubsub'><items node='http://jabber.org/protocol/nick'/></pubsub></iq>` },
    { wait_for: "id='r3'", timeout: 8 },
    { sleep: 1 }
  ])
  const r = read.received
  t.check('the other client reads it from vcard-temp', /<FN>Moho Probe<\/FN>/.test(r) && /<USERID>probe@example.org<\/USERID>/.test(r) && /<(DESC|NOTE)>Testing, testing.<\/(DESC|NOTE)>/.test(r), r.slice(r.indexOf("id='r1'") - 50, r.indexOf("id='r1'") + 600))
  t.check('and from vCard4', /<fn><text>Moho Probe<\/text><\/fn>/.test(r) && /<uri>https:\/\/moho.example\/<\/uri>/.test(r))
  t.check('and the nickname from its node', /<nick xmlns=['"]http:\/\/jabber.org\/protocol\/nick['"]>probey<\/nick>/.test(r))
  const back = await t.rpc('xmppGetProfile', { accountId: myId })
  t.check('and the account tools read it back as it was written', Object.keys(mine).every((k) => back[k] === mine[k]), JSON.stringify(back))
} catch (err) {
  t.failed(err)
} finally {
  await sleep(200)
  await t.finish()
}
