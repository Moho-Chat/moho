#!/usr/bin/env node
/**
 * Calls (XEP-0353 Jingle Message Initiation, XEP-0166 Jingle): the daemon's half. A call is signalling here and WebRTC in the
 * window, so what is checked is the translation both ways - against a counterpart (slixmpp) sent the stanzas another client
 * writes, by hand, and not ones this daemon wrote. The window's side is the call vocabulary it already speaks for Matrix.
 *
 *   ~/.local/share/moho-dev/xmpp-test.sh up && (cd nobilis && cargo build --release) && node scripts/probe-xmpp-calls.mjs
 */
import { start, sleep } from './lib/xmpp-daemon.mjs'

const t = await start({ people: 3 })
const [me, you, stranger] = t.accounts
const myId = t.accountId(me)
const ice = 'a=ice-ufrag:Zt3k\r\na=ice-pwd:aSecretPasswordForIce12345\r\na=ice-options:trickle\r\na=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99\r\n'
const audio = (setup) => `m=audio 9 UDP/TLS/RTP/SAVPF 111 0\r\nc=IN IP4 0.0.0.0\r\na=rtcp:9 IN IP4 0.0.0.0\r\n${ice}a=setup:${setup}\r\na=mid:0\r\na=extmap:1 urn:ietf:rfc:ssrc-audio-level\r\na=sendrecv\r\na=rtcp-mux\r\na=rtpmap:111 opus/48000/2\r\na=rtcp-fb:111 transport-cc\r\na=fmtp:111 minptime=10;useinbandfec=1\r\na=rtpmap:0 PCMU/8000\r\na=ssrc:1001 cname:cn1\r\n`
const sdp = (setup) => `v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\n${audio(setup)}`
const video = (mid, direction) => `m=video 9 UDP/TLS/RTP/SAVPF 96\r\nc=IN IP4 0.0.0.0\r\na=rtcp:9 IN IP4 0.0.0.0\r\n${ice}a=setup:actpass\r\na=mid:${mid}\r\na=${direction}\r\na=rtcp-mux\r\na=rtpmap:96 VP8/90000\r\na=rtcp-fb:96 nack\r\n`
const withVideo = (setup, mids, direction = 'sendrecv') => `v=0\r\no=- 4611731400430051336 3 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0 ${mids.join(' ')}\r\n${audio(setup)}${mids.map((m) => video(m, direction)).join('')}`
const jingleOffer = (sid, from) => `<iq xmlns='jabber:client' type='set' to='{{from_of:id='${sid}'}}' id='ji-${sid}'><jingle xmlns='urn:xmpp:jingle:1' action='session-initiate' sid='${sid}' initiator='${from}'><group xmlns='urn:xmpp:jingle:apps:grouping:0' semantics='BUNDLE'><content name='0'/></group><content creator='initiator' name='0' senders='both'><description xmlns='urn:xmpp:jingle:apps:rtp:1' media='audio'><payload-type id='111' name='opus' clockrate='48000' channels='2'><parameter name='minptime' value='10'/><rtcp-fb xmlns='urn:xmpp:jingle:apps:rtp:rtcp-fb:0' type='transport-cc'/></payload-type><payload-type id='0' name='PCMU' clockrate='8000'/><rtcp-mux/><rtp-hdrext xmlns='urn:xmpp:jingle:apps:rtp:rtp-hdrext:0' id='1' uri='urn:ietf:params:rtp-hdrext:ssrc-audio-level'/><source xmlns='urn:xmpp:jingle:apps:rtp:ssma:0' ssrc='4242'><parameter name='cname' value='peer1'/></source></description><transport xmlns='urn:xmpp:jingle:transports:ice-udp:1' ufrag='PeerU' pwd='PeerPasswordForIce123456'><fingerprint xmlns='urn:xmpp:jingle:apps:dtls:0' hash='sha-256' setup='actpass'>11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00</fingerprint></transport></content></jingle></iq>`
const candidateInfo = (sid, id) => `<iq xmlns='jabber:client' type='set' to='{{from_of:id='${sid}'}}' id='${id}'><jingle xmlns='urn:xmpp:jingle:1' action='transport-info' sid='${sid}'><content creator='initiator' name='0'><transport xmlns='urn:xmpp:jingle:transports:ice-udp:1' ufrag='PeerU' pwd='PeerPasswordForIce123456'><candidate component='1' foundation='1' generation='0' id='c1' ip='203.0.113.9' network='0' port='50500' priority='2122260223' protocol='udp' type='host'/></transport></content></jingle></iq>`
const call = (bufferId, type, content) => t.rpc('sendMatrixCallEvent', { bufferId, type, content })
const got = (kind, callId) => t.seen('matrixCall', (d) => d.kind === kind && d.callId === callId)

try {
  t.check('the account signs in', await t.signIn(me))
  await sleep(500)
  await t.rpc('xmppAddContact', { accountId: myId, jid: you.jid, name: 'Bea' })
  await t.peer(you, [{ wait_for: 'subscribe', timeout: 8 }, { accept: me.jid }, { sleep: 1 }])
  const b = await t.until(async () => (await t.rpc('listBuffers')).find((x) => x.accountId === myId && x.remoteId === you.jid) ?? null)

  console.log('the server and the relays')
  const servers = await t.rpc('matrixTurnServers', { accountId: myId })
  t.check('the relays the server offers are asked for, and answered in the window\'s shape', Array.isArray(servers.uris), JSON.stringify(servers))
  const info = await t.rpc('xmppServerInfo', { accountId: myId })
  console.log('   (the server ' + (info.features.some((f) => f.var === 'urn:xmpp:extdisco:2') ? 'offers' : 'does not offer') + ' external service discovery)')

  console.log('a call that comes in')
  const sid = `in-${t.stamp}`
  t.events.length = 0
  const incoming = t.peer(you, [
    { raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='p-${sid}'><propose xmlns='urn:xmpp:jingle-message:0' id='${sid}'><description xmlns='urn:xmpp:jingle:apps:rtp:1' media='audio'/></propose><store xmlns='urn:xmpp:hints'/></message>` },
    { wait_for: `id='${sid}'`, timeout: 30 },
    { raw: jingleOffer(sid, `${you.jid}/peer`) },
    { wait_for: 'session-accept', timeout: 30 },
    { sleep: 0.5 },
    { raw: candidateInfo(sid, `ti-${sid}`) },
    { sleep: 1.5 },
    { raw: `<iq xmlns='jabber:client' type='set' to='{{from_of:id='${sid}'}}' id='bye-${sid}'><jingle xmlns='urn:xmpp:jingle:1' action='session-terminate' sid='${sid}'><reason><success/></reason></jingle></iq>` },
    { sleep: 1 }
  ])
  const ring = await t.until(() => got('m.call.invite', sid))
  t.check('it rings with the kind of call, before there is an offer', !!ring && ring.content.moho_deferred === true && /^m=audio/m.test(ring.content.offer.sdp) && !/^m=video/m.test(ring.content.offer.sdp), JSON.stringify(ring))
  t.check('and in the conversation with the person', ring?.bufferId === b.id, ring?.bufferId)
  await call(b.id, 'm.call.proceed', { call_id: sid })
  const offer = await t.until(() => t.events.find((e) => e.event === 'matrixCall' && e.data.kind === 'm.call.invite' && e.data.callId === sid && !e.data.content.moho_deferred)?.data ?? null)
  const o = offer?.content.offer.sdp ?? ''
  t.check('when the session comes, it is an offer the window can answer', /^m=audio 9 UDP\/TLS\/RTP\/SAVPF 111 0/m.test(o) && /a=rtpmap:111 opus\/48000\/2/.test(o) && /a=ice-ufrag:PeerU/.test(o) && /a=setup:actpass/.test(o) && /a=rtcp-mux/.test(o) && /a=group:BUNDLE 0/.test(o) && /a=ssrc:4242 cname:peer1/.test(o), o)
  if (!offer && process.env.DEBUG_PEER) console.log(JSON.stringify(await incoming).slice(-3000))
  await sleep(500)
  t.check('the other end\'s candidates are held until the window has its offer answered', !got('m.call.candidates', sid))
  await call(b.id, 'm.call.answer', { call_id: sid, answer: { type: 'answer', sdp: sdp('active') } })
  const done = await incoming
  t.check('the answer reaches the other end as the session accepted', /action=['"]session-accept['"]/.test(done.received) && /name=['"]opus['"]/.test(done.received) && /<fingerprint[^>]*setup=['"]active['"]/.test(done.received) && /ufrag=['"]Zt3k['"]/.test(done.received) && /senders=['"]both['"]/.test(done.received), done.received.slice(-1500))
  const cand = await t.until(() => got('m.call.candidates', sid))
  t.check('and then their candidates are handed over, in the form the browser takes', !!cand && cand.content.candidates[0].candidate.startsWith('candidate:1 1 udp 2122260223 203.0.113.9 50500 typ host') && cand.content.candidates[0].sdpMid === '0' && cand.content.candidates[0].sdpMLineIndex === 0, JSON.stringify(cand))
  t.check('their ending the session ends the call', !!(await t.until(() => got('m.call.hangup', sid))))

  console.log('a call that is declined, and one that is retracted')
  const sid2 = `no-${t.stamp}`
  const refused = t.peer(you, [
    { raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='p-${sid2}'><propose xmlns='urn:xmpp:jingle-message:0' id='${sid2}'><description xmlns='urn:xmpp:jingle:apps:rtp:1' media='audio'/><description xmlns='urn:xmpp:jingle:apps:rtp:1' media='video'/></propose></message>` },
    { wait_for: `id='${sid2}'`, timeout: 20 }
  ])
  const ring2 = await t.until(() => got('m.call.invite', sid2))
  t.check('a call with a camera says so', /^m=video/m.test(ring2?.content.offer.sdp ?? ''), JSON.stringify(ring2))
  await call(b.id, 'm.call.hangup', { call_id: sid2, reason: 'user_hangup' })
  const r = await refused
  t.check('declining it tells them', (r.received.match(/<reject[^>]*>/g) ?? []).some((e) => e.includes('jingle-message:0') && e.includes(sid2)), r.received.slice(-400))
  const sid3 = `re-${t.stamp}`
  t.events.length = 0
  const retract = t.peer(you, [
    { raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='p-${sid3}'><propose xmlns='urn:xmpp:jingle-message:0' id='${sid3}'><description xmlns='urn:xmpp:jingle:apps:rtp:1' media='audio'/></propose></message>` },
    { sleep: 1 },
    { raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='r-${sid3}'><retract xmlns='urn:xmpp:jingle-message:0' id='${sid3}'/></message>` },
    { sleep: 1 }
  ])
  await retract
  t.check('a call the caller gives up on stops ringing', !!got('m.call.invite', sid3) && !!got('m.call.hangup', sid3))

  console.log('somebody who is not a contact')
  const sid4 = `st-${t.stamp}`
  t.events.length = 0
  await t.peer(stranger, [{ raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='p-${sid4}'><propose xmlns='urn:xmpp:jingle-message:0' id='${sid4}'><description xmlns='urn:xmpp:jingle:apps:rtp:1' media='audio'/></propose></message>` }, { sleep: 1.5 }])
  t.check('does not ring', !got('m.call.invite', sid4))

  console.log('a call that goes out')
  const sid5 = `out-${t.stamp}`
  t.events.length = 0
  const outgoing = t.peer(you, [
    { wait_for: 'jingle-message:0', timeout: 30 },
    { raw: `<message xmlns='jabber:client' to='{{from_of:jingle-message:0}}' type='chat' id='pr-${sid5}'><proceed xmlns='urn:xmpp:jingle-message:0' id='${sid5}'/></message>` },
    { wait_for: 'session-initiate', timeout: 30 },
    { raw: `<iq xmlns='jabber:client' type='set' to='{{from_of:jingle-message:0}}' id='ac-${sid5}'><jingle xmlns='urn:xmpp:jingle:1' action='session-accept' sid='${sid5}' responder='${you.jid}/peer'><group xmlns='urn:xmpp:jingle:apps:grouping:0' semantics='BUNDLE'><content name='0'/></group><content creator='initiator' name='0' senders='both'><description xmlns='urn:xmpp:jingle:apps:rtp:1' media='audio'><payload-type id='111' name='opus' clockrate='48000' channels='2'/><rtcp-mux/></description><transport xmlns='urn:xmpp:jingle:transports:ice-udp:1' ufrag='AnsU' pwd='AnswerPasswordForIce12345'><fingerprint xmlns='urn:xmpp:jingle:apps:dtls:0' hash='sha-256' setup='active'>22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11</fingerprint></transport></content></jingle></iq>` },
    // The picture added by the caller, taken by this end.
    { wait_for: "action='content-add'", timeout: 30 },
    { raw: `<iq xmlns='jabber:client' type='set' to='{{from_of:jingle-message:0}}' id='ca-${sid5}'><jingle xmlns='urn:xmpp:jingle:1' action='content-accept' sid='${sid5}'><content creator='initiator' name='1' senders='both'><description xmlns='urn:xmpp:jingle:apps:rtp:1' media='video'><payload-type id='96' name='VP8' clockrate='90000'/><rtcp-mux/></description><transport xmlns='urn:xmpp:jingle:transports:ice-udp:1' ufrag='AnsU' pwd='AnswerPasswordForIce12345'/></content></jingle></iq>` },
    // The caller puts it away to a one-way picture; this end does nothing but acknowledge.
    { wait_for: "action='content-modify'", timeout: 30 },
    // A second picture, from this end.
    { raw: `<iq xmlns='jabber:client' type='set' to='{{from_of:jingle-message:0}}' id='cb-${sid5}'><jingle xmlns='urn:xmpp:jingle:1' action='content-add' sid='${sid5}'><content creator='responder' name='2' senders='both'><description xmlns='urn:xmpp:jingle:apps:rtp:1' media='video'><payload-type id='96' name='VP8' clockrate='90000'/><rtcp-mux/></description><transport xmlns='urn:xmpp:jingle:transports:ice-udp:1' ufrag='AnsU' pwd='AnswerPasswordForIce12345'/></content></jingle></iq>` },
    { wait_for: "action='content-accept'", timeout: 30 },
    { wait_for: 'transport-info', timeout: 30 },
    { wait_for: 'session-terminate', timeout: 30 }
  ])
  await call(b.id, 'm.call.invite', { call_id: sid5, offer: { type: 'offer', sdp: sdp('actpass') }, lifetime: 60000 })
  const answered = await t.until(() => got('m.call.answer', sid5), 30000)
  const a = answered?.content.answer.sdp ?? ''
  t.check('the other end takes the call and their answer reaches the window as an SDP', /a=setup:active/.test(a) && /a=ice-ufrag:AnsU/.test(a) && /a=rtpmap:111 opus\/48000\/2/.test(a) && /a=mid:0/.test(a) && /a=rtcp-mux/.test(a), a)
  console.log('a call that is changed while it is up')
  t.events.length = 0
  await call(b.id, 'm.call.negotiate', { call_id: sid5, description: { type: 'offer', sdp: withVideo('actpass', ['1']) } })
  const added = await t.until(() => t.events.find((e) => e.event === 'matrixCall' && e.data.kind === 'm.call.negotiate' && e.data.callId === sid5 && e.data.content.description.type === 'answer')?.data ?? null, 20000)
  const ad = added?.content.description.sdp ?? ''
  t.check('a picture added to the call is taken by the other end, and the window is given the answer with a section for it', /^m=video 9 /m.test(ad) && /a=mid:1/.test(ad) && /a=rtpmap:96 VP8\/90000/.test(ad) && /a=sendrecv/.test(ad) && /a=group:BUNDLE 0 1/.test(ad), ad)
  t.events.length = 0
  await call(b.id, 'm.call.negotiate', { call_id: sid5, description: { type: 'offer', sdp: withVideo('actpass', ['1'], 'recvonly').replace('a=sendrecv\r\na=rtcp-mux\r\na=rtpmap:111', 'a=sendrecv\r\na=rtcp-mux\r\na=rtpmap:111') } })
  const modified = await t.until(() => t.events.find((e) => e.event === 'matrixCall' && e.data.kind === 'm.call.negotiate' && e.data.content.description.type === 'answer')?.data ?? null, 20000)
  const md = modified?.content.description.sdp ?? ''
  t.check('using it another way is a modification, answered as soon as the other end has taken it', !!modified && /a=sendonly/.test(md), md)
  const theirs = await t.until(() => t.events.find((e) => e.event === 'matrixCall' && e.data.kind === 'm.call.negotiate' && e.data.content.description.type === 'offer')?.data ?? null, 20000)
  const offered = theirs?.content.description.sdp ?? ''
  t.check('a picture the other end adds is offered to the window as the whole call with the new section in it', /a=mid:2/.test(offered) && (offered.match(/^m=video/gm) ?? []).length === 2 && /a=group:BUNDLE 0 1 2/.test(offered) && /a=ice-ufrag:AnsU/.test(offered), offered)
  await call(b.id, 'm.call.negotiate', { call_id: sid5, description: { type: 'answer', sdp: withVideo('active', ['1', '2']) } })
  await sleep(800)
  await call(b.id, 'm.call.candidates', { call_id: sid5, candidates: [{ candidate: 'candidate:842163049 1 udp 1677729535 192.0.2.10 54321 typ srflx raddr 10.0.0.5 rport 54321 generation 0', sdpMid: '0', sdpMLineIndex: 0 }] })
  await sleep(800)
  await call(b.id, 'm.call.hangup', { call_id: sid5, reason: 'user_hangup' })
  const out = await outgoing
  t.check('the offer went out as a session with what the browser offered', /<propose[^>]*jingle-message/.test(out.received) && /name=['"]opus['"]/.test(out.received) && /ufrag=['"]Zt3k['"]/.test(out.received) && /setup=['"]actpass['"]/.test(out.received) && /<group[^>]*BUNDLE/.test(out.received), out.received.slice(0, 1800))
  t.check('their candidates go out as transport-info with the credentials of the content', /action=['"]transport-info['"]/.test(out.received) && /ip=['"]192\.0\.2\.10['"]/.test(out.received) && /type=['"]srflx['"]/.test(out.received) && /rel-addr=['"]10\.0\.0\.5['"]/.test(out.received))
  const element = (action) => (out.received.match(new RegExp(`<jingle[^>]*action=['"]${action}['"][\\s\\S]*?</jingle>`)) ?? [''])[0]
  t.check('a picture added went out as a content-add that names the new section and its media', /name=['"]1['"]/.test(element('content-add')) && /media=['"]video['"]/.test(element('content-add')) && /creator=['"]initiator['"]/.test(element('content-add')) && /name=['"]VP8['"]/.test(element('content-add')), element('content-add'))
  t.check('using it one way only went out as a content-modify that says who sends', /name=['"]1['"]/.test(element('content-modify')) && /senders=['"]responder['"]/.test(element('content-modify')), element('content-modify'))
  t.check('and the window\'s answer to the other end\'s picture went out as a content-accept of the section, by whoever made it', /name=['"]2['"]/.test(element('content-accept')) && /creator=['"]responder['"]/.test(element('content-accept')) && /media=['"]video['"]/.test(element('content-accept')), element('content-accept'))
  t.check('and hanging up ends the session', /action=['"]session-terminate['"]/.test(out.received) && /<success/.test(out.received), out.received.slice(-500))
} catch (err) {
  t.failed(err)
} finally {
  await t.finish()
}
