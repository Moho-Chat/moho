#!/usr/bin/env node
/**
 * Finding the server from the address alone, as DNS publishes it: SRV for direct TLS and for STARTTLS (XEP-0368) taken
 * together, by priority, direct TLS first on a tie; a host that does not answer passed over for the next; a service DNS says
 * is not offered (the "." target) not tried; and an internationalised domain, typed in either form, looked up in its ASCII
 * form and its certificate checked against that.
 *
 *   ~/.local/share/moho-dev/xmpp-test.sh prosody && ~/.local/share/moho-dev/xmpp-test.sh dns
 *   node scripts/probe-xmpp-srv.mjs
 *
 * Against Prosody's `srv.test` and `bücher.test` (the test servers' other domains are under .localhost, which DNS libraries
 * answer themselves without asking). The test DNS on 127.0.0.2 publishes their records (/1tb/xmpp-test/dns/moho-dns.conf), and
 * the daemon runs in a mount namespace of its own whose resolv.conf names it (see `start({ resolver })`).
 */
import { execFileSync } from 'node:child_process'
import { start, ca } from './lib/xmpp-daemon.mjs'

const t = await start({ people: 0, resolver: '127.0.0.2' })
const lines = (re) => t.log.split('\n').filter((l) => re.test(l))
const prosodyctl = (...a) => execFileSync('docker', ['-H', 'unix:///run/docker-xmpp.sock', 'exec', 'prosody', 'prosodyctl', ...a], { stdio: 'ignore' })
const srv = { name: `srv${t.stamp}`, domain: 'srv.test', password: `pw-${t.stamp}-s` }
const idn = { name: `idn${t.stamp}`, domain: 'bücher.test', password: `pw-${t.stamp}-i` }
const stateOf = async (id) => (await t.rpc('listAccounts')).find((a) => a.id === id)?.state
try {
  for (const p of [srv, idn]) prosodyctl('register', p.name, p.domain, p.password)

  console.log('SRV for both services')
  const srvId = `xmpp:${srv.name}@srv.test`
  await t.rpc('addXmppAccount', { jid: `${srv.name}@srv.test`, password: srv.password, caPem: ca })
  t.check('an account with no server named signs in', (await t.until(async () => (await stateOf(srvId)) === 'connected', 30000)) !== null, await stateOf(srvId))
  const said = lines(new RegExp(`xmpp\\[${srvId}\\]: DNS says`)).pop() ?? ''
  t.check('DNS is asked for both services and they are taken together by priority, direct TLS first on a tie', /DNS says dead\.test:5999 \(TLS\), pr\.test:5233 \(TLS\), pr\.test:5232$/.test(said), said)
  t.check('a host that does not answer is passed over', lines(new RegExp(`xmpp\\[${srvId}\\]: dead\\.test:5999 did not work`)).length > 0, lines(/did not work/).join('\n'))
  t.check('and the next one is reached, with direct TLS', lines(new RegExp(`xmpp\\[${srvId}\\]: reached pr\\.test:5233 \\(direct TLS\\)`)).length > 0, lines(/reached/).join('\n'))

  console.log('an internationalised domain')
  const r = await t.rpc('addXmppAccount', { jid: `${idn.name}@xn--bcher-kva.test`, password: idn.password, caPem: ca })
  const id = r.accountId
  t.check('an address typed with the ASCII form of the domain is kept in its Unicode form', id === `xmpp:${idn.name}@bücher.test`, id)
  t.check('it signs in', (await t.until(async () => (await stateOf(id)) === 'connected', 30000)) !== null, await stateOf(id))
  const dns = lines(new RegExp(`xmpp\\[${id}\\]: DNS says`)).pop() ?? ''
  t.check('DNS was asked in the ASCII form; direct TLS, which it says is not offered, was not tried', /DNS says pr\.test:5232$/.test(dns), dns)
  t.check('the certificate, which names only xn--bcher-kva.test, was checked against the ASCII name and accepted', lines(new RegExp(`xmpp\\[${id}\\]: reached pr\\.test:5232 \\(STARTTLS\\)`)).length > 0)
} catch (err) {
  t.failed(err)
} finally {
  for (const p of [srv, idn]) {
    try {
      prosodyctl('deluser', `${p.name}@${p.domain}`)
    } catch {
      /* not made */
    }
  }
  await t.finish()
}
