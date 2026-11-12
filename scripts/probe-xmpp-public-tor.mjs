#!/usr/bin/env node
/**
 * Public XMPP servers through moho's own Tor (the embedded client), with credentials that are wrong on purpose: nothing is
 * registered and nobody signs in. What it finds out is whether a server lets a Tor user get as far as being refused a password -
 * which is as far as anybody can get without an account, and far enough to show Tor, TLS and SASL all work against it.
 *
 * Each server is tried twice, the same way: directly first (so a server that is down, or does not take this client at all, is not
 * blamed on Tor), then through Tor. The address is the server's own SRV record, looked up here (only for the test: a routed
 * account normally looks nothing up).
 *
 *   node scripts/probe-xmpp-public-tor.mjs chapril.org jabber.fr …      (default: the XMPP Providers project's category A list)
 *   node scripts/probe-xmpp-public-tor.mjs durare.org=durare.org:443:direct    (an address of one's own choosing)
 *
 * Prints one line per server and a JSON summary.
 */
import dns from 'node:dns/promises'
import { start, sleep } from './lib/xmpp-daemon.mjs'

const DEFAULT = ['07f.de', 'chalec.org', 'chapril.org', 'chatterboxtown.us', 'hookipa.net', 'jabber.fr', 'jabber.vg', 'jabjab.de', 'lain.rocks', 'magicbroccoli.de', 'nixnet.services', 'og.im', 'openim.nl', 'projectsegfau.lt', 'xmpp.jp', 'xmpp.party', 'yax.im']
const servers = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT
const t = await start({ people: 0 })

/** Where a server says its clients connect: STARTTLS first, then direct TLS, then the domain itself. */
async function where(domain) {
  for (const [service, security] of [['_xmpp-client._tcp', 'starttls'], ['_xmpps-client._tcp', 'direct']]) {
    try {
      const records = (await dns.resolveSrv(`${service}.${domain}`)).filter((r) => r.name && r.name !== '.')
      records.sort((a, b) => a.priority - b.priority || b.weight - a.weight)
      if (records.length) return { host: records[0].name, port: records[0].port, security }
    } catch {}
  }
  return { host: domain, port: 5222, security: 'starttls' }
}

/** One sign-in with a made-up account. What became of it: refused a password (the server was reached), or why not. */
async function attempt(domain, target, useTor, ms) {
  const jid = `mohoprobe${Math.random().toString(36).slice(2, 10)}@${domain}`
  const id = `xmpp:${jid}`
  const since = t.events.length
  await t.rpc('addXmppAccount', { jid, password: `wrong-${Math.random().toString(36).slice(2)}`, host: target.host, port: target.port, security: target.security, useTor })
  const words = () =>
    t.events
      .slice(since)
      .filter((e) => e.event === 'connectionState' && e.data?.accountId === id)
      .map((e) => [e.data.state, e.data.detail ?? e.data.error ?? ''].filter(Boolean).join(': '))
  const end = Date.now() + ms
  let outcome = 'timeout'
  let account = null
  while (Date.now() < end) {
    account = (await t.rpc('listAccounts')).find((a) => a.id === id)
    const said = words().join(' | ')
    if (account?.state === 'connected') {
      outcome = 'signed-in'
      break
    }
    if (account?.state === 'auth_failed' || /not-authorized|password|credentials|authenticat/i.test(said)) {
      outcome = 'refused-password'
      break
    }
    await sleep(500)
  }
  const detail = [...new Set(words())].slice(-4).join(' | ') || account?.stopReason || account?.state || ''
  await t.rpc('removeAccount', { accountId: id }).catch(() => {})
  await sleep(500)
  return { outcome, detail: detail.slice(0, 300) }
}

const results = []
try {
  await t.rpc('setNetSettings', { torMode: 'embedded' })
  for (const arg of servers) {
    const [domain, named] = arg.split('=')
    const [host, port, security] = (named ?? '').split(':')
    const target = named ? { host, port: Number(port), security: security || 'starttls' } : await where(domain)
    const direct = await attempt(domain, target, false, 40000)
    // A first Tor connection waits for the embedded client to start; later ones do not.
    const tor = await attempt(domain, target, true, results.length === 0 ? 180000 : 90000)
    const verdict = tor.outcome === 'refused-password' || tor.outcome === 'signed-in' ? 'WORKS over Tor' : direct.outcome === 'refused-password' ? 'TOR REJECTED' : 'UNREACHABLE (direct too)'
    results.push({ domain, ...target, direct, tor, verdict })
    console.log(`${verdict.padEnd(26)} ${domain} (${target.host}:${target.port} ${target.security})\n    direct: ${direct.outcome} ${direct.detail}\n    tor:    ${tor.outcome} ${tor.detail}`)
  }
} catch (err) {
  t.failed(err)
} finally {
  console.log(JSON.stringify(results.map(({ domain, verdict, tor, direct }) => ({ domain, verdict, tor: tor.outcome, direct: direct.outcome }))))
  if (process.env.XMPP_PROBE_LOG) console.log(t.log.split('\n').filter((l) => /tor|arti|xmpp/i.test(l)).slice(-200).join('\n'))
  t.cleanup()
  process.exit(0)
}
