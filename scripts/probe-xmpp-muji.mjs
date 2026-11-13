#!/usr/bin/env node
/**
 * Group calls (XEP-0272 Multiparty Jingle, XEP-0482 Call Invites), the daemon's half, against a counterpart (slixmpp) sent the
 * stanzas Dino writes, by hand. The window's side is the mesh it already holds for Matrix: a member list, a membership, and one
 * call per pair whose signals name the conference.
 *
 * - moho starts a call in a chat room: a room of the call's own is made, private and showing who is who, and the chat room is
 *   rung with a call invite (with Dino's older copy); somebody who joins it and calls this end is listed and their session reaches
 *   the window as a leg of the conference; leaving says so;
 * - moho is rung into somebody's call and joins it: it says it accepts, sees who is there, and calls them (it arrived last), its
 *   session naming the call's room.
 *
 *   node scripts/probe-xmpp-muji.mjs           XMPP_TEST_SERVER=prosody node scripts/probe-xmpp-muji.mjs
 */
import { start, sleep, CONF } from './lib/xmpp-daemon.mjs'

const t = await start({ people: 2 })
const [me, you] = t.accounts
const myId = t.accountId(me)
const ice = 'a=ice-ufrag:Zt3k\r\na=ice-pwd:aSecretPasswordForIce12345\r\na=ice-options:trickle\r\na=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99\r\n'
const sdp = (setup) => `v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nc=IN IP4 0.0.0.0\r\na=rtcp:9 IN IP4 0.0.0.0\r\n${ice}a=setup:${setup}\r\na=mid:0\r\na=sendrecv\r\na=rtcp-mux\r\na=rtpmap:111 opus/48000/2\r\n`
const call = (bufferId, type, content) => t.rpc('sendMatrixCallEvent', { bufferId, type, content })
const members = (bufferId) => t.events.filter((e) => e.event === 'matrixCallMembers' && e.data.bufferId === bufferId).map((e) => e.data.members).at(-1) ?? null
const audioContent = (creator) => `<content creator='${creator}' name='audio' senders='both'><description xmlns='urn:xmpp:jingle:apps:rtp:1' media='audio'><payload-type id='111' name='opus' clockrate='48000' channels='2'/><rtcp-mux/></description><transport xmlns='urn:xmpp:jingle:transports:ice-udp:1' ufrag='PeerU' pwd='PeerPasswordForIce123456'><fingerprint xmlns='urn:xmpp:jingle:apps:dtls:0' hash='sha-256' setup='${creator === 'initiator' ? 'actpass' : 'active'}'>11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00</fingerprint></transport></content>`
const mujiContents = `<muji xmlns='urn:xmpp:jingle:muji:0'><content xmlns='urn:xmpp:jingle:1' name='audio'><description xmlns='urn:xmpp:jingle:apps:rtp:1' media='audio'><payload-type id='111' name='opus' clockrate='48000' channels='2'/></description></content></muji>`
const roomOf = "muji[^>]*room=['\"]([^'\"]+)"

try {
  t.check('the account signs in', await t.signIn(me))
  await t.rpc('xmppAddContact', { accountId: myId, jid: you.jid, name: 'Bea' })
  await t.peer(you, [{ wait_for: 'subscribe', timeout: 8 }, { accept: me.jid }, { sleep: 1 }])
  const b = await t.until(async () => (await t.rpc('listBuffers')).find((x) => x.accountId === myId && x.remoteId === you.jid) ?? null)
  const resource = /resource = "([^"]+)"/.exec(t.accountsToml())?.[1]
  const meFull = `${me.jid}/${resource}`
  const ownKey = `${me.jid}|${resource}`

  console.log('a group call started here, in a chat room')
  const chat = `mujichat${t.stamp}@${CONF}`
  await t.rpc('xmppJoinRoom', { accountId: myId, jid: chat, nick: 'mohonick' })
  const rb = await t.until(async () => (await t.rpc('listBuffers')).find((x) => x.accountId === myId && x.remoteId === chat && x.kind === 'channel') ?? null)
  await t.rpc('subscribe', { bufferId: rb.id })
  await sleep(1500)
  await t.rpc('xmppSetRoomConfig', { bufferId: rb.id, answers: { 'muc#roomconfig_whois': 'anyone', 'muc#roomconfig_membersonly': true, 'muc#roomconfig_persistentroom': true } })
  await t.rpc('xmppRoomAction', { bufferId: rb.id, action: 'member', jid: you.jid })
  await sleep(800)
  const legA = `muji-a-${t.stamp}`
  const joiner = t.peer(you, [
    { raw: `<presence xmlns='jabber:client' to='${chat}/bea'><x xmlns='http://jabber.org/protocol/muc'/></presence>` },
    { wait_for: 'call-invites:0', timeout: 30 },
    { raw: `<presence xmlns='jabber:client' to='{{re:${roomOf}}}/0bea0bea'><x xmlns='http://jabber.org/protocol/muc'/><muji xmlns='urn:xmpp:jingle:muji:0'><preparing/></muji></presence>` },
    { sleep: 1 },
    { raw: `<presence xmlns='jabber:client' to='{{re:${roomOf}}}/0bea0bea'>${mujiContents}</presence>` },
    { sleep: 1.5 },
    // The newcomer calls everybody already there, at their real address.
    { raw: `<iq xmlns='jabber:client' type='set' to='${meFull}' id='si-${legA}'><jingle xmlns='urn:xmpp:jingle:1' action='session-initiate' sid='${legA}' initiator='${you.jid}/peer'><muji xmlns='urn:xmpp:jingle:muji:0' room='{{re:${roomOf}}}'/>${audioContent('initiator')}</jingle></iq>` },
    { raw: `<message xmlns='jabber:client' to='${chat}' type='groupchat' id='acc-${legA}'><accept xmlns='urn:xmpp:call-invites:0' id='{{re:<invite (?=[^>]*call-invites:0)[^>]*id=['"]([^'"]+)}}'><muji xmlns='urn:xmpp:jingle:muji:0' room='{{re:${roomOf}}}'/></accept><store xmlns='urn:xmpp:hints'/></message>` },
    { wait_for: "action='session-accept'", timeout: 30 },
    { wait_for: 'urn:xmpp:call-message:1', timeout: 5 },
    { wait_for: '<left', timeout: 30 }
  ])
  await sleep(3500)
  t.events.length = 0
  const joined = await t.rpc('setMatrixCallMembership', { bufferId: rb.id, joined: true })
  const callRoom = joined.roomId ?? ''
  t.check('joining starts the call: this end in a room of the call\'s own on the conference service', joined.userId === me.jid && joined.deviceId === resource && callRoom.endsWith(`@${CONF}`) && callRoom !== chat, JSON.stringify(joined))
  const theirs = await t.until(() => (members(rb.id) ?? []).find((m) => m.user_id === you.jid) ?? null, 30000)
  t.check('somebody who joins is listed for the window, as one who calls this end', !!theirs && theirs.offer === false && theirs.transports?.includes('moho.mesh'), JSON.stringify(members(rb.id)))
  const leg = await t.until(() => t.seen('matrixCall', (d) => d.kind === 'm.call.invite' && d.callId === legA), 20000)
  t.check('their session reaches the window as a leg of the conference, naming both ends', leg?.content.conf_id === `moho-conf-${callRoom}` && leg?.content.party_id?.startsWith(`${you.jid}|`) && leg?.content.dest_session_id === ownKey && /a=rtpmap:111 opus/.test(leg?.content.offer?.sdp ?? ''), JSON.stringify(leg?.content).slice(0, 400))
  await call(rb.id, 'm.call.answer', { call_id: legA, answer: { type: 'answer', sdp: sdp('active') }, conf_id: `moho-conf-${callRoom}`, party_id: ownKey, dest_session_id: leg?.content.party_id })
  await sleep(1200)
  const listed = await t.rpc('listMatrixCallMembers', { bufferId: rb.id })
  t.check('the window can ask who is in it', listed.some((m) => m.user_id === you.jid), JSON.stringify(listed))
  await t.rpc('setMatrixCallMembership', { bufferId: rb.id, joined: false })
  const ja = await joiner
  const invite = /<message[^>]*type=['"]groupchat['"][^>]*>(?:(?!<\/message>).)*<invite[^>]*call-invites:0(?:(?!<\/message>).)*<\/message>/s.exec(ja.received)?.[0] ?? ''
  t.check('the chat room was rung with a call invite naming the call\'s room, with Dino\'s older copy, kept', invite.includes(`room='${callRoom}'`) || invite.includes(`room="${callRoom}"`), invite.slice(0, 600) || ja.received.slice(-1500))
  t.check('  … the id on the invite itself, the older copy and the hint beside it', /<invite[^>]*\bid=/.test(invite) && /<propose[^>]*call-message:1/.test(invite) && /<store[^>]*urn:xmpp:hints/.test(invite), invite.slice(0, 600))
  t.check('the window\'s answer went out as the session\'s accept', /action=['"]session-accept['"]/.test(ja.received), ja.failed)
  t.check('leaving says so in the chat room', /<left[^>]*call-invites:0/.test(ja.received) && /<finish[^>]*call-message:1/.test(ja.received), ja.failed + ja.received.slice(-800))
  t.check('and the window is told nobody is in it here any more', JSON.stringify(members(rb.id)) === '[]', JSON.stringify(members(rb.id)))

  console.log("rung into somebody's call")
  const theirRoom = `mujib${t.stamp}@${CONF}`
  const legB = `muji-b-${t.stamp}`
  t.events.length = 0
  const host = t.peer(you, [
    { raw: `<presence xmlns='jabber:client' to='${theirRoom}/0b0b0b0b'><x xmlns='http://jabber.org/protocol/muc'/><muji xmlns='urn:xmpp:jingle:muji:0'><preparing/></muji></presence>` },
    { wait_for: "code='110'", timeout: 10 },
    { raw: `<iq xmlns='jabber:client' type='set' to='${theirRoom}' id='cfg-b'><query xmlns='http://jabber.org/protocol/muc#owner'><x xmlns='jabber:x:data' type='submit'><field var='FORM_TYPE'><value>http://jabber.org/protocol/muc#roomconfig</value></field><field var='muc#roomconfig_whois'><value>anyone</value></field><field var='muc#roomconfig_persistentroom'><value>0</value></field></x></query></iq>` },
    { wait_for: "id='cfg-b'", timeout: 10 },
    { raw: `<presence xmlns='jabber:client' to='${theirRoom}/0b0b0b0b'>${mujiContents}</presence>` },
    { sleep: 0.5 },
    { raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='inv-${legB}'><invite xmlns='urn:xmpp:call-invites:0' id='call-${legB}' video='false' multi='true'><muji xmlns='urn:xmpp:jingle:muji:0' room='${theirRoom}'/></invite><store xmlns='urn:xmpp:hints'/></message>` },
    { wait_for: 'session-initiate', timeout: 40 },
    { raw: `<iq xmlns='jabber:client' type='set' to='${meFull}' id='sa-${legB}'><jingle xmlns='urn:xmpp:jingle:1' action='session-accept' sid='${legB}' responder='${you.jid}/peer'>${audioContent('initiator').replace("setup='actpass'", "setup='active'")}</jingle></iq>` },
    { wait_for: '<left', timeout: 40 }
  ])
  const rung = await t.until(() => (members(b.id) ?? []).find((m) => m.user_id === you.jid) ?? null, 20000)
  t.check('being rung shows the call in the conversation, with who rang', !!rung, JSON.stringify(t.events.filter((e) => e.event === 'matrixCallMembers')))
  const noted = await t.until(async () => (await t.rpc('getBacklog', { bufferId: b.id, limit: 20 })).find((m) => /calling you into a group call/.test(m.body)) ?? null, 5000)
  t.check('and says so in it', !!noted)
  const joinedB = await t.rpc('setMatrixCallMembership', { bufferId: b.id, joined: true })
  t.check('joining it goes to their call\'s room', joinedB.roomId === theirRoom, JSON.stringify(joinedB))
  const there = (members(b.id) ?? []).find((m) => m.user_id === you.jid)
  t.check('who is already there is listed as one this end calls (it arrived last)', there?.offer === true, JSON.stringify(members(b.id)))
  const theirKey = there ? `${there.user_id}|${there.membership.device_id}` : ''
  await call(b.id, 'm.call.invite', { call_id: legB, conf_id: `moho-conf-${theirRoom}`, party_id: ownKey, dest_session_id: theirKey, offer: { type: 'offer', sdp: sdp('actpass') }, lifetime: 60000 })
  const answered = await t.until(() => t.seen('matrixCall', (d) => d.kind === 'm.call.answer' && d.callId === legB), 30000)
  t.check('the window\'s leg goes to them as a session, and their accept comes back as the leg\'s answer', answered?.content.conf_id === `moho-conf-${theirRoom}` && /a=ice-ufrag:PeerU/.test(answered?.content.answer?.sdp ?? ''), JSON.stringify(answered?.content).slice(0, 300))
  await call(b.id, 'm.call.hangup', { call_id: legB, reason: 'user_hangup', conf_id: `moho-conf-${theirRoom}` })
  await t.rpc('setMatrixCallMembership', { bufferId: b.id, joined: false })
  const hb = await host
  t.check('it said it accepts the invite, by the invite\'s id', new RegExp(`<accept[^>]*call-invites:0[^>]*call-${legB}|<accept[^>]*call-${legB}[^>]*call-invites:0`).test(hb.received), hb.failed + hb.received.slice(-1200))
  t.check('its session went to their real address and named the call\'s room', new RegExp(`session-initiate[^]*<muji[^>]*room=['"]${theirRoom}`).test(hb.received), hb.received.slice(-1500))
  t.check('and it left, saying so', /<left[^>]*call-invites:0/.test(hb.received) && new RegExp(`from=['"]${theirRoom}/[0-9a-f]{8}['"][^>]*type=['"]unavailable|type=['"]unavailable['"][^>]*from=['"]${theirRoom}/`).test(hb.received), hb.failed)
} catch (err) {
  t.failed(err)
} finally {
  await t.finish()
}
