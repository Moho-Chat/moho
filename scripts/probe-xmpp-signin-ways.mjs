#!/usr/bin/env node
/**
 * Signing in without a password: by a client certificate (SASL EXTERNAL, RFC 6120 with RFC 4422), and as nobody at all (SASL
 * ANONYMOUS, RFC 4505) where the server lets anybody in.
 *
 *   node scripts/probe-xmpp-signin-ways.mjs                               (ejabberd: EXTERNAL on its port 5224; anonymous refused)
 *   XMPP_TEST_SERVER=prosody node scripts/probe-xmpp-signin-ways.mjs      (Prosody: anonymous on anon.xmpp2.localhost)
 *
 * The client certificates are made on the spot by the test CA (/1tb/xmpp-test/pki), naming the account in its XMPP address
 * (id-on-xmppAddr), as a server checking certificates wants.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { start, ca, SERVER } from './lib/xmpp-daemon.mjs'

const pki = '/1tb/xmpp-test/pki'
function clientCert(jid) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moho-cc-'))
  const run = (...a) => execFileSync('openssl', a, { cwd: dir, stdio: 'ignore' })
  run('req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', 'k.pem', '-subj', `/CN=${jid}`, '-out', 'c.csr')
  fs.writeFileSync(path.join(dir, 'ext.cnf'), `subjectAltName=otherName:1.3.6.1.5.5.7.8.5;UTF8:${jid}\nextendedKeyUsage=clientAuth\nbasicConstraints=CA:FALSE\n`)
  run('x509', '-req', '-in', 'c.csr', '-CA', `${pki}/ca.pem`, '-CAkey', `${pki}/ca.key`, '-CAcreateserial', '-CAserial', 'ca.srl', '-days', '2', '-out', 'c.pem', '-extfile', 'ext.cnf')
  const pem = fs.readFileSync(path.join(dir, 'c.pem'), 'utf8') + fs.readFileSync(path.join(dir, 'k.pem'), 'utf8')
  fs.rmSync(dir, { recursive: true, force: true })
  return pem
}

const t = await start({ people: 2 })
const [me, other] = t.accounts
const lines = (id) => t.log.split('\n').filter((l) => l.includes(`xmpp[${id}]`) || l.includes(`xmpp[${id.replace(/^xmpp:/, '')}]`))
const stateOf = async (id) => (await t.rpc('listAccounts')).find((a) => a.id === id)?.state
const lastWords = (id) => t.events.filter((e) => e.event === 'connectionState' && e.data?.accountId === id).map((e) => e.data?.error ?? e.data?.detail ?? '').filter(Boolean).pop() ?? ''
try {
  if (SERVER !== 'prosody') {
    console.log('a client certificate (SASL EXTERNAL)')
    const id = t.accountId(me)
    const r = await t.rpc('addXmppAccount', { jid: me.jid, clientCertPem: clientCert(me.jid), host: '127.0.0.1', port: 5224, security: 'direct', caPem: ca })
    t.check('an account with a certificate and no password is made', r.accountId === id, JSON.stringify(r))
    t.check('and signs in', (await t.until(async () => (await stateOf(id)) === 'connected', 20000)) !== null, await stateOf(id))
    t.check('with EXTERNAL, the password never asked for', lines(id).some((l) => /signed in with EXTERNAL/.test(l)), lines(id).slice(-4).join('\n'))
    t.check('it is kept as a sign-in', /client_cert_pem = /.test(t.accountsToml()) && !/password = "[^"]/.test(t.accountsToml().split('[[xmpp_account]]').pop() ?? ''))

    const otherId = t.accountId(other)
    await t.rpc('addXmppAccount', { jid: other.jid, clientCertPem: clientCert(me.jid), host: '127.0.0.1', port: 5224, security: 'direct', caPem: ca })
    t.check("a certificate that names somebody else does not sign in as them", (await t.until(async () => (await stateOf(otherId)) === 'auth_failed', 15000)) !== null, await stateOf(otherId))
    t.check('and says so', /did not accept|refused|not authorized/i.test(lastWords(otherId)), lastWords(otherId))
    await t.rpc('removeAccount', { accountId: otherId })

    console.log('anonymous where it is not allowed')
    const anonId = 'xmpp:localhost'
    await t.rpc('addXmppAccount', { jid: 'localhost', anonymous: true, host: '127.0.0.1', caPem: ca })
    t.check('stops, in words', (await t.until(async () => (await stateOf(anonId)) === 'auth_failed', 15000)) !== null && /without an account/.test(lastWords(anonId)), lastWords(anonId))
  } else {
    console.log('anonymous (SASL ANONYMOUS)')
    const anonId = 'xmpp:anon.xmpp2.localhost'
    const r = await t.rpc('addXmppAccount', { jid: 'anon.xmpp2.localhost', anonymous: true, host: '127.0.0.1', port: 5232, caPem: ca })
    t.check('a session with no account is made from the server address alone', r.accountId === anonId, JSON.stringify(r))
    t.check('and signs in', (await t.until(async () => (await stateOf(anonId)) === 'connected', 20000)) !== null, await stateOf(anonId))
    const signedIn = lines(anonId)
    t.check('with ANONYMOUS, and the server gave it an address of its own', signedIn.some((l) => /signed in with ANONYMOUS/.test(l)) && signedIn.some((l) => /signed in as [^@\s]+@anon\.xmpp2\.localhost\//.test(l)), signedIn.slice(-4).join('\n'))
    // An anonymous session can still talk: a room on the main domain, say, or a person.
    const b = await t.until(async () => (await t.rpc('listAccounts')).find((a) => a.id === anonId))
    t.check('it is listed as an account', !!b)
  }
} catch (err) {
  t.failed(err)
} finally {
  await t.finish()
}
