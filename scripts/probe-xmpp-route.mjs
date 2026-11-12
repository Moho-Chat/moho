#!/usr/bin/env node
/**
 * An XMPP account routed through a SOCKS5 proxy (the setting moho shares with Tor): the connection goes through the proxy, a
 * domain is handed to the proxy as a name and never looked up here, the add form's switch is what routes the account, and
 * when the proxy goes away the account waits for it instead of connecting directly.
 *
 *   node scripts/probe-xmpp-route.mjs          (ejabberd)     XMPP_TEST_SERVER=prosody node scripts/probe-xmpp-route.mjs
 *
 * The proxy is the probe's own (a few lines of SOCKS5 below), so what it was asked can be seen.
 */
import net from 'node:net'
import { start, ca, PORT, DOMAIN, sleep } from './lib/xmpp-daemon.mjs'

/** SOCKS5, no authentication, CONNECT only; remembers what it was asked for. */
function socks5(port) {
  const asked = []
  const live = new Set()
  const server = net.createServer((client) => {
    live.add(client)
    client.on('close', () => live.delete(client))
    client.on('error', () => {})
    client.once('data', (hello) => {
      if (hello[0] !== 5) return client.destroy()
      client.write(Buffer.from([5, 0]))
      client.once('data', (req) => {
        const atyp = req[3]
        let host
        let at
        if (atyp === 1) {
          host = [...req.subarray(4, 8)].join('.')
          at = 8
        } else if (atyp === 3) {
          host = req.subarray(5, 5 + req[4]).toString()
          at = 5 + req[4]
        } else {
          host = 'ipv6'
          at = 20
        }
        const port = req.readUInt16BE(at)
        asked.push({ host, port, byName: atyp === 3 })
        // The test server's domain at the standard port is where the test server really is (Prosody's is mapped to 5232).
        const [toHost, toPort] = host === DOMAIN && port === 5222 ? ['127.0.0.1', PORT] : [host === 'localhost' || host.endsWith('.localhost') ? '127.0.0.1' : host, port]
        const upstream = net.connect(toPort, toHost, () => {
          client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
          client.pipe(upstream)
          upstream.pipe(client)
        })
        live.add(upstream)
        upstream.on('close', () => live.delete(upstream))
        upstream.on('error', () => client.destroy())
      })
    })
  })
  server.listen(port, '127.0.0.1')
  return { asked, close: () => (server.close(), [...live].forEach((s) => s.destroy())) }
}

const t = await start({ people: 2 })
const [named, bare] = t.accounts
const proxyPort = 5293
let proxy = socks5(proxyPort)
try {
  await t.rpc('setNetSettings', { torMode: 'proxy', proxy: `socks5h://127.0.0.1:${proxyPort}` })

  console.log('an account with a server named, routed')
  await t.rpc('addXmppAccount', { jid: named.jid, password: named.password, host: '127.0.0.1', port: PORT, caPem: ca, useTor: true })
  t.check('signs in', !!(await t.until(async () => (await t.state(named)) === 'connected', 20000)), await t.state(named))
  t.check('through the proxy', proxy.asked.some((a) => a.host === '127.0.0.1' && a.port === PORT), JSON.stringify(proxy.asked))
  t.check('the add form\'s switch is kept with the account', /jid = "[^"]+"[\s\S]*?use_tor = true/.test(t.accountsToml()))

  console.log('an account with nothing but its address, routed')
  await t.rpc('addXmppAccount', { jid: bare.jid, password: bare.password, caPem: ca, useTor: true })
  t.check('signs in', !!(await t.until(async () => (await t.state(bare)) === 'connected', 20000)), await t.state(bare))
  t.check('the proxy was given the domain as a name: nothing was looked up here, SRV included', proxy.asked.some((a) => a.host === DOMAIN && a.byName && a.port === 5222), JSON.stringify(proxy.asked))

  console.log('calls on an account that goes through the proxy')
  await t.rpc('xmppAddContact', { accountId: t.accountId(named), jid: bare.jid, name: 'Bea' })
  const conv = await t.until(async () => (await t.rpc('listBuffers')).find((b) => b.accountId === t.accountId(named) && b.remoteId === bare.jid) ?? null)
  const placed = await t.rpc('sendMatrixCallEvent', { bufferId: conv.id, type: 'm.call.invite', content: { call_id: `routed-${t.stamp}`, offer: { type: 'offer', sdp: 'v=0' }, lifetime: 60000 } }).then(() => 'placed', (e) => e.message)
  t.check('placing a call is refused, saying why (its media would go around Tor)', /Calls are off for this account because it goes through Tor/.test(placed), placed)
  const sid = `in-routed-${t.stamp}`
  const rung = await t.peer(bare, [
    { raw: `<message xmlns='jabber:client' to='${named.jid}' type='chat' id='p-${sid}'><propose xmlns='urn:xmpp:jingle-message:0' id='${sid}'><description xmlns='urn:xmpp:jingle:apps:rtp:1' media='audio'/></propose></message>` },
    { wait_for: '<reject', timeout: 10 }
  ])
  t.check('a call that comes in is declined to the caller', new RegExp(`<reject[^>]*${sid}`).test(rung.received), rung.failed)
  t.check('nothing rings here', !t.events.some((e) => e.event === 'matrixCall' && e.data?.callId === sid))
  const said = await t.until(async () => (await t.rpc('getBacklog', { bufferId: conv.id, limit: 20 })).find((m) => /called, and the call was declined/.test(m.body)) ?? null, 8000)
  t.check('and the conversation says why', !!said && /goes through Tor/.test(said.body), JSON.stringify(said))

  console.log('the proxy goes away')
  const before = proxy.asked.length
  proxy.close()
  await sleep(500)
  const fellBack = await t.until(async () => (await t.state(named)) === 'connected' && (await t.state(bare)) === 'connected', 12000)
  t.check('the accounts do not connect directly instead', !fellBack, `${await t.state(named)} ${await t.state(bare)}`)
  const words = t.events.filter((e) => e.event === 'connectionState' && [t.accountId(named), t.accountId(bare)].includes(e.data?.accountId)).map((e) => e.data?.detail ?? e.data?.error ?? '').filter(Boolean).pop() ?? ''
  t.check('and say why', /proxy/.test(words), words)
  proxy = socks5(proxyPort)
  t.check('when it is back, they connect through it again', !!(await t.until(async () => (await t.state(named)) === 'connected' && (await t.state(bare)) === 'connected', 90000)) && proxy.asked.length > 0, `${proxy.asked.length} ${before}`)
} catch (err) {
  t.failed(err)
} finally {
  proxy.close()
  await t.finish()
}
