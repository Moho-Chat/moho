#!/usr/bin/env node
/**
 * Links, and what this client tells others about itself, against another client (slixmpp):
 *
 * - a link the sender described (XEP-0511, OpenGraph in RDF) is a card, with a picture that came inside the message and the
 *   host the link is really on; a description of a link the message does not show is not a card;
 * - a YouTube link is described by the unfurler every service shares, the account's own way (needs the internet; skipped with
 *   XMPP_PROBE_OFFLINE=1);
 * - asked when it was last active (XEP-0012), this client refuses, on purpose;
 * - answers go to the person's bare address, never to the one device that last wrote (RFC 6121 5.1: no resource locking).
 *
 *   node scripts/probe-xmpp-links.mjs        (ejabberd)        XMPP_TEST_SERVER=prosody node scripts/probe-xmpp-links.mjs
 */
import { start, sleep } from './lib/xmpp-daemon.mjs'

const t = await start({ people: 2 })
const [me, you] = t.accounts
const myId = t.accountId(me)
// A 1x1 transparent PNG.
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const card = (about, title) =>
  `<rdf:Description xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#' xmlns:og='https://ogp.me/ns#' xmlns:ogi='https://ogp.me/ns#image:' rdf:about='${about}'>` +
  `<og:title>${title}</og:title><og:description>A page worth reading</og:description><og:site_name>Totally Your Bank</og:site_name>` +
  `<og:image>https://tracker.example/pixel.png</og:image><og:image>data:image/png;base64,${png}</og:image><ogi:alt>Nothing much</ogi:alt></rdf:Description>`
try {
  t.check('it signs in', !!(await t.signIn(me)))
  await t.peer(you, [{ raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='l-0'><body>hello</body></message>` }, { sleep: 1 }])
  const b = await t.until(async () => (await t.rpc('listBuffers')).find((x) => x.accountId === myId && x.remoteId === you.jid) ?? null)
  t.check('a conversation', !!b)
  await t.rpc('subscribe', { bufferId: b.id })

  console.log('a link its sender described (XEP-0511)')
  await t.peer(you, [
    { raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='l-1'><body>read https://news.example.org/story please</body>${card('https://news.example.org/story', 'The Story')}</message>` },
    { raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='l-2'><body>no link here</body>${card('https://elsewhere.example/', 'Not Shown')}</message>` },
    { sleep: 1.5 }
  ])
  const m1 = await t.until(async () => t.seen('message', (d) => d.body?.includes('news.example.org/story')))
  const e = m1?.embeds?.[0]
  t.check('is a card with the title and description the sender gave', e?.title === 'The Story' && e?.description === 'A page worth reading', JSON.stringify(m1?.embeds))
  t.check('the picture that came inside the message is shown; the one elsewhere is not fetched', /^file:\/\//.test(e?.imageUrl ?? '') && !t.log.includes('tracker.example'), e?.imageUrl)
  t.check('the host the link is really on comes first, whatever the sender calls the site', /^news\.example\.org/.test(e?.provider ?? ''), e?.provider)
  const m2 = await t.until(async () => t.seen('message', (d) => d.body === 'no link here'))
  t.check('a description of a link the message does not show is not a card', !!m2 && !(m2.embeds?.length), JSON.stringify(m2?.embeds))

  if (!process.env.XMPP_PROBE_OFFLINE) {
    console.log('a YouTube link nobody described')
    await t.peer(you, [{ raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='l-3'><body>https://www.youtube.com/watch?v=dQw4w9WgXcQ</body></message>` }, { sleep: 1 }])
    const described = await t.until(async () => t.events.find((ev) => ev.event === 'messageUpdated' && ev.data?.bufferId === b.id && (ev.data?.embeds ?? []).some((x) => /youtube/i.test(x.provider ?? ''))), 20000)
    t.check('is described by the shared unfurler', !!described, JSON.stringify(t.events.filter((ev) => ev.event === 'messageUpdated').slice(-2)))
  }

  console.log('what it says about itself')
  const resource = /resource = "([^"]+)"/.exec(t.accountsToml())?.[1]
  const asked = await t.peer(you, [{ raw: `<iq xmlns='jabber:client' to='${me.jid}/${resource}' type='get' id='last-1'><query xmlns='jabber:iq:last'/></iq>` }, { wait_for: "id='last-1'", timeout: 8 }, { sleep: 0.5 }])
  const answer = asked.received.slice(asked.received.lastIndexOf("id='last-1'") - 200)
  t.check('asked when it was last active, it refuses (service-unavailable)', /type=['"]error['"]/.test(answer) && /service-unavailable/.test(answer), answer.slice(0, 400))

  console.log('answers go to the bare address')
  await t.peer(you, [{ raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='l-4'><body>from one of my devices</body></message>` }, { sleep: 1 }])
  await t.until(async () => t.seen('message', (d) => d.body === 'from one of my devices'))
  await t.rpc('sendMessage', { bufferId: b.id, body: 'answering all of you' })
  const out = await t.peer(you, [{ wait_for: 'answering all of you', timeout: 8 }])
  const at = out.received.indexOf('answering all of you')
  const sent = out.received.slice(out.received.lastIndexOf('<message', at), at)
  const to = /<message[^>]*\bto=['"]([^'"]+)['"]/g
  let last = null
  for (let m; (m = to.exec(sent)); ) last = m[1]
  t.check('the message is addressed to the person, not to the device that wrote last', last === you.jid, `${last} ${sent.slice(-900)}`)
} catch (err) {
  t.failed(err)
} finally {
  await sleep(200)
  await t.finish()
}
