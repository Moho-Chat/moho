#!/usr/bin/env node
/**
 * Invitations (XEP-0401, XEP-0379): an account asks its server for an invitation link, and somebody who follows it is a contact
 * without the request waiting for an answer - the token goes with the request and the inviter's server approves it.
 *
 *   node scripts/probe-xmpp-invites.mjs        (ejabberd)        XMPP_TEST_SERVER=prosody node scripts/probe-xmpp-invites.mjs
 *
 * Both sides are moho accounts in one daemon. What a server does with the token is its own: neither test server applies one
 * to a request from an account that already exists (XEP-0379 in full); both apply it when the invited person makes an account
 * with it, which is the path an invitation is mostly for. So the probe checks that the token goes with the request (on the
 * wire), and that an account made with the invitation ends up a contact of the inviter.
 */
import { start, sleep, ca, PORT, DOMAIN, unregisterUser } from './lib/xmpp-daemon.mjs'

process.env.RUST_LOG = `${process.env.RUST_LOG ?? 'info'},tokio_xmpp::xmlstream::capture=trace`

const t = await start({ people: 2 })
const [me, you] = t.accounts
const [myId, yourId] = [t.accountId(me), t.accountId(you)]
try {
  t.check('both sign in', !!(await t.signIn(me)) && !!(await t.signIn(you)))
  const kinds = (await t.rpc('xmppInviteKinds', { accountId: myId })).kinds
  t.check('the server says it makes contact invitations', kinds.includes('contact'), JSON.stringify(kinds))
  const invite = await t.rpc('xmppCreateInvite', { accountId: myId, kind: 'contact' })
  const token = /[?;]preauth=([^;&]+)/.exec(invite.uri)?.[1]
  t.check('an invitation is made: a link with a token, and when it stops working', invite.uri.startsWith(`xmpp:${me.jid}?roster`) && !!token && /^20\d\d-/.test(invite.expires), JSON.stringify(invite))

  await t.rpc('xmppAddContact', { accountId: yourId, jid: me.jid, name: 'Inviter', preauth: decodeURIComponent(token) })
  const b = await t.until(async () => (await t.rpc('listBuffers')).find((x) => x.accountId === yourId && x.remoteId === me.jid) ?? null)
  t.check('following it adds them', !!b)
  const approved = await t.until(async () => t.events.filter((e) => e.event === 'presenceChange' && e.data?.bufferId === b?.id).map((e) => e.data.members.find((m) => m.userId === me.jid)).find((m) => ['to', 'both'].includes(m?.relationship)), 10000)
  t.check('the request carries the invitation\'s token (XEP-0379)', t.log.includes(`<preauth xmlns='urn:xmpp:pars:0' token='${decodeURIComponent(token)}'`), '')
  if (approved) t.check('and this server approved it at once', true)
  else console.log('  (this server does not apply a token to an existing account\'s request: the inviter is asked as usual)')

  console.log('an account made with the invitation')
  const second = await t.rpc('xmppCreateInvite', { accountId: myId, kind: 'contact' })
  const preauth = decodeURIComponent(/[?;]preauth=([^;&]+)/.exec(second.uri)?.[1] ?? '')
  const fresh = `inv${t.stamp}`
  const params = { jid: DOMAIN, host: '127.0.0.1', port: PORT, caPem: ca, preauth }
  try {
    const form = await t.rpc('xmppRegistrationForm', params)
    t.check('the server asks for the account', !!form.form, JSON.stringify(form).slice(0, 300))
    const made = await t.rpc('xmppRegister', { ...params, inviter: me.jid, answers: { username: fresh, password: `pw-${t.stamp}-fresh` } })
    t.check('it is made and signs in', !!(await t.until(async () => (await t.rpc('listAccounts')).find((a) => a.id === made.accountId)?.state === 'connected', 20000)), JSON.stringify(made))
    const freshJid = `${fresh}@${DOMAIN}`
    const linked = await t.until(async () => {
      const both = await t.rpc('listBuffers')
      return both.some((x) => x.accountId === made.accountId && x.remoteId === me.jid) && both.some((x) => x.accountId === myId && x.remoteId === freshJid)
    }, 15000)
    t.check('and the inviter and the new account are each other\'s contacts, nobody asked', !!linked, JSON.stringify((await t.rpc('listBuffers')).filter((x) => [made.accountId, myId].includes(x.accountId)).map((x) => `${x.accountId} ${x.remoteId}`)))
  } finally {
    try {
      unregisterUser(fresh)
    } catch {
      /* not made */
    }
  }
} catch (err) {
  t.failed(err)
} finally {
  await t.finish()
}
