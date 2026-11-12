#!/usr/bin/env node
/**
 * What a stranger's server says about their account when they ask to see this one's presence (XEP-0489): shown with the
 * request on the Invitations tile when that server says it adds it; ignored when a client wrote it itself on a server that does
 * not say so (it could be a lie).
 *
 *   XMPP_TEST_SERVER=prosody node scripts/probe-xmpp-affiliation.mjs   (Prosody with mod_report_affiliations: it adds it)
 *   node scripts/probe-xmpp-affiliation.mjs                            (ejabberd: it does not; a forged one is ignored)
 */
import { start, sleep, SERVER } from './lib/xmpp-daemon.mjs'

const t = await start({ people: 2 })
const [me, you] = t.accounts
const myId = t.accountId(me)
try {
  t.check('it signs in', !!(await t.signIn(me)))
  // A request from somebody this account has never heard of; on ejabberd the client puts in a flattering claim of its own.
  const forged = SERVER === 'prosody' ? '' : "<info xmlns='urn:xmpp:raa:0' affiliation='admin' trust='100'/>"
  await t.peer(you, [{ raw: `<presence xmlns='jabber:client' to='${me.jid}' type='subscribe'><status>hi, it is me</status>${forged}</presence>` }, { sleep: 2 }])
  const request = await t.until(async () => (await t.rpc('xmppRequests', { accountId: myId })).requests.find((r) => r.jid === you.jid && (SERVER !== 'prosody' || r.server)), 8000)
  t.check('the request is waiting, with their words', request?.text === 'hi, it is me', JSON.stringify(request))
  if (SERVER === 'prosody') {
    t.check('and what their server says about their account', /registered (today|yesterday|\d+ days ago)/.test(request?.server ?? '') && /trust \d+\/100/.test(request?.server ?? ''), request?.server)
  } else {
    await sleep(1500)
    const again = (await t.rpc('xmppRequests', { accountId: myId })).requests.find((r) => r.jid === you.jid)
    t.check('a claim their server does not vouch for is not shown', !again?.server, JSON.stringify(again))
  }
} catch (err) {
  t.failed(err)
} finally {
  await t.finish()
}
