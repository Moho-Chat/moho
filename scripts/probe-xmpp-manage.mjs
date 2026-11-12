#!/usr/bin/env node
/**
 * The account's own data on its server, from its page: what it publishes (PEP nodes) - listed and named, who may read each
 * changed and the change seen from another client, emptied, deleted - and privacy lists (XEP-0016), where the server has them:
 * a rule made, made active, and seen to work.
 *
 *   node scripts/probe-xmpp-manage.mjs        (ejabberd)        XMPP_TEST_SERVER=prosody node scripts/probe-xmpp-manage.mjs
 */
import { start, sleep, SERVER } from './lib/xmpp-daemon.mjs'

const t = await start({ people: 2 })
const [me, you] = t.accounts
const myId = t.accountId(me)
const call = (method, params = {}) => t.rpc(method, { accountId: myId, ...params })
// What the conversation with them holds (a stranger's message opens one; the window is not watching it).
const said = async () => {
  const b = (await t.rpc('listBuffers')).find((x) => x.accountId === myId && x.remoteId === you.jid)
  return b ? ((await t.rpc('getBacklog', { bufferId: b.id, limit: 50 })) ?? []).map((m) => m.body) : []
}
const readVcard = async (id) => {
  const r = await t.peer(you, [{ raw: `<iq xmlns='jabber:client' type='get' id='${id}' to='${me.jid}'><pubsub xmlns='http://jabber.org/protocol/pubsub'><items node='urn:xmpp:vcard4'/></pubsub></iq>` }, { wait_for: `id='${id}'`, timeout: 8 }, { sleep: 0.3 }])
  return r.received.slice(r.received.indexOf(`id='${id}'`) - 200)
}
try {
  t.check('it signs in', !!(await t.signIn(me)))
  await call('xmppSetProfile', { fullName: 'Node Probe', nickname: 'nodey', email: '', url: '', note: '' })

  console.log('what the account publishes')
  let nodes = (await call('xmppNodes')).nodes
  const vcard = nodes.find((n) => n.node === 'urn:xmpp:vcard4')
  t.check('its nodes are listed and named, with who may read them', vcard?.what === 'Your profile (vCard)' && vcard.access === 'open' && vcard.items === 1 && vcard.used_here === true, JSON.stringify(vcard))
  t.check("moho's own nodes are marked as such", nodes.filter((n) => n.used_here).length >= 2, JSON.stringify(nodes.map((n) => n.node)))
  t.check('another client can read the vCard while anybody may', /<fn><text>Node Probe<\/text><\/fn>/.test(await readVcard('v1')))
  await call('xmppNodeAccess', { node: 'urn:xmpp:vcard4', access: 'whitelist' })
  t.check('made "only you", it no longer can', !/<fn><text>Node Probe/.test(await readVcard('v2')))
  await call('xmppNodeAccess', { node: 'urn:xmpp:vcard4', access: 'open' })
  t.check('and opened again, it can', /<fn><text>Node Probe<\/text><\/fn>/.test(await readVcard('v3')))
  await call('xmppNodeRemove', { node: 'http://jabber.org/protocol/nick', delete: false })
  nodes = (await call('xmppNodes')).nodes
  t.check('a node is emptied', nodes.find((n) => n.node === 'http://jabber.org/protocol/nick')?.items === 0, JSON.stringify(nodes.find((n) => n.node === 'http://jabber.org/protocol/nick')))
  await call('xmppNodeRemove', { node: 'http://jabber.org/protocol/nick', delete: true })
  nodes = (await call('xmppNodes')).nodes
  t.check('and deleted', !nodes.some((n) => n.node === 'http://jabber.org/protocol/nick'))

  console.log('privacy lists')
  if (SERVER === 'prosody') {
    const err = await call('xmppPrivacyLists').then(() => '', (e) => e.message)
    t.check('a server without them says so, in words', /not support|does not/i.test(err), err)
  } else {
    await call('xmppSetPrivacyList', { name: 'quiet', rules: [{ type: 'jid', value: you.jid, action: 'deny', order: 1, what: ['message'] }, { type: '', value: '', action: 'allow', order: 2, what: [] }] })
    const lists = await call('xmppPrivacyLists')
    t.check('a list is made', lists.names.includes('quiet'), JSON.stringify(lists))
    const rules = (await call('xmppPrivacyRules', { name: 'quiet' })).rules
    t.check('and read back in words', rules[0]?.words === `Deny messages - ${you.jid}` && rules[1]?.words === 'Allow everything - everybody', JSON.stringify(rules.map((r) => r.words)))
    await call('xmppChoosePrivacyList', { which: 'active', name: 'quiet' })
    await t.peer(you, [{ raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='q-1'><body>can you hear me</body></message>` }, { sleep: 1.5 }])
    t.check('made active, it stops their messages', !(await said()).includes('can you hear me'))
    await call('xmppChoosePrivacyList', { which: 'active', name: '' })
    await t.peer(you, [{ raw: `<message xmlns='jabber:client' to='${me.jid}' type='chat' id='q-2'><body>and now</body></message>` }, { sleep: 1.5 }])
    t.check('and no longer active, they come through', !!(await t.until(async () => (await said()).includes('and now'), 6000)), JSON.stringify(await said()))
    await call('xmppSetPrivacyList', { name: 'quiet', rules: [] })
    t.check('a list is deleted', !(await call('xmppPrivacyLists')).names.includes('quiet'))
  }
} catch (err) {
  t.failed(err)
} finally {
  await sleep(200)
  await t.finish()
}
