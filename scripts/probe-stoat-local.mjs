#!/usr/bin/env node
/**
 * moho against the local self-hosted Stoat, signed in as alice, with bob as the other person: what bob does is seen,
 * and what alice does in moho is seen from bob's side.
 *
 *   ~/.local/share/moho-dev/stoat-docker.sh start && cd /1tb/stoat-test/selfhosted && DOCKER_HOST=unix:///run/docker-stoat.sock docker compose up -d
 *   node scripts/probe-stoat-local.mjs <output directory>
 */
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, sleep } from './lib/harness.mjs'
import { accounts, as, upload, API } from './lib/stoat-local.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const acc = accounts()
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const ev = (code) => page.evaluate(code)
const rpc = (method, params = {}) => ev(`window.moho.rpc(${JSON.stringify(method)}, ${JSON.stringify(params)})`)
const shot = async (name) => {
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
}
const results = []
const check = (what, ok, detail = '') => {
  results.push(ok)
  console.log(ok ? '  ok  ' : '  FAIL', what, detail)
}
const until = async (what, fn, ms = 15000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    try {
      const v = await fn()
      if (v) return v
    } catch {
      /* not yet */
    }
    await sleep(250)
  }
  return null
}
try {
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await rpc('addStoatAccountToken', { instance: API, token: acc.alice.token })
  const account = `stoat:${acc.alice.id}`
  const connected = await until('connected', async () => (await rpc('listAccounts')).find((a) => a.id === account && a.state === 'connected'))
  check('alice connects to the local instance', !!connected)
  await ev(`window.__mohoShots?.store.refreshAccounts?.(); window.__mohoShots?.store.refreshBuffers?.()`)
  const general = `${account}|Test Hall/#General`
  const buffers = await until('buffers', async () => {
    const b = (await rpc('listBuffers')).filter((x) => x.accountId === account)
    return b.some((x) => x.id === general) ? b : null
  })
  check('the server and its channels are made', !!buffers, JSON.stringify(buffers?.map((b) => b.name)))
  check('a voice room is a conversation too, marked as one', buffers?.find((b) => /Voice Room/.test(b.name))?.nameIcon === 'volume_up')
  check('bob is a DM-able friend but no DM exists yet', !buffers?.some((b) => b.kind === 'dm' && b.name === 'bob'))
  const channel = acc.server.channels.General

  // bob speaks.
  await rpc('subscribe', { bufferId: general }).catch(() => {})
  await as('bob', 'POST', `/channels/${channel}/messages`, { content: 'hello from bob, **bold** and !!a secret!!' })
  const heard = await until('bob heard', async () => (await rpc('getBacklog', { bufferId: general })).find((m) => /hello from bob/.test(m.body)))
  check('what bob says is heard', !!heard, heard && JSON.stringify([heard.from, heard.body]))
  check('with its spoiler in the window’s marks', /\|\|a secret\|\|/.test(heard?.body ?? ''))

  // alice speaks, in moho.
  await rpc('sendMessage', { bufferId: general, body: 'hello from moho' })
  const seen = await until('alice seen', async () => (await as('bob', 'GET', `/channels/${channel}/messages?limit=10`)).find((m) => m.content === 'hello from moho'))
  check('what alice says in moho is seen by bob', !!seen)

  // a reply, an edit, a reaction, a delete.
  const mine = (await rpc('getBacklog', { bufferId: general })).find((m) => m.body === 'hello from moho')
  await rpc('editMessage', { bufferId: general, messageId: mine.id, body: 'hello from moho (edited)' })
  const edited = await until('edited', async () => (await as('bob', 'GET', `/channels/${channel}/messages/${mine.id}`)).content === 'hello from moho (edited)')
  check('an edit reaches bob', !!edited)
  await rpc('toggleReaction', { bufferId: general, messageId: mine.id, emoji: '👍', add: true }).catch((e) => console.log('react:', e.message))
  const reacted = await until('reacted', async () => Object.keys((await as('bob', 'GET', `/channels/${channel}/messages/${mine.id}`)).reactions ?? {}).includes('👍'))
  check('a reaction reaches bob', !!reacted)
  await as('bob', 'PUT', `/channels/${channel}/messages/${mine.id}/reactions/${encodeURIComponent('🔥')}`)
  const flame = await until('flame', async () => (await rpc('getBacklog', { bufferId: general })).find((m) => m.id === mine.id)?.reactions?.some((r) => r.emoji === '🔥'))
  check('and bob’s reaches moho', !!flame)
  await rpc('deleteMessage', { bufferId: general, messageId: mine.id })
  const gone = await until('gone', async () => !(await as('bob', 'GET', `/channels/${channel}/messages?limit=10`)).some((m) => m.id === mine.id))
  check('a delete reaches bob', !!gone)


  // The people here, and who one of them is.
  await rpc('requestMemberList', { bufferId: general })
  const roster = await until('roster', () => ev(`window.__mohoShots.state().presenceByBuffer[${JSON.stringify(general)}]`))
  check('the member list names alice and bob', !!roster?.some((m) => m.nick === 'alice') && !!roster?.some((m) => m.nick === 'bob'), JSON.stringify(roster?.map((m) => [m.nick, m.status])))
  check('alice, who is connected, is online, and bob, who is not, is offline', roster?.find((m) => m.nick === 'alice')?.status === 'online' && roster?.find((m) => m.nick === 'bob')?.status === 'offline')
  await rpc('requestProfile', { bufferId: general, nick: 'bob', userId: acc.bob.id })
  const card = await until('profile', () => ev(`(() => { const p = window.__mohoShots.state().profile; return p && p.id === ${JSON.stringify(acc.bob.id)} && !p.pending ? p : null })()`))
  check('bob’s card says who he is, when the account was made and when he joined', !!card && /^bob#/.test(card.handle ?? '') && !!card.createdTs && !!card.joinedTs, JSON.stringify(card && [card.name, card.handle, card.createdTs, card.joinedTs]))

  // Files, both ways.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const fileId = await upload('bob', 'dot.png', png, 'image/png')
  await as('bob', 'POST', `/channels/${channel}/messages`, { content: 'a picture', attachments: [fileId] })
  const pic = await until('picture heard', async () => (await rpc('getBacklog', { bufferId: general })).find((m) => m.body === 'a picture' && m.attachments?.length))
  if (!pic) console.log('backlog:', JSON.stringify((await rpc('getBacklog', { bufferId: general })).slice(-4).map((m) => [m.body, m.attachments])), 'bob’s view:', JSON.stringify((await as('bob', 'GET', `/channels/${channel}/messages?limit=2`)).map((m) => m.attachments)))
  check('a picture bob sends arrives as an attachment', !!pic && pic.attachments[0].kind === 'image' && pic.attachments[0].filename === 'dot.png', JSON.stringify(pic?.attachments?.[0]))
  const fetched = await rpc('restoreMedia', { path: pic.attachments[0].path }).catch((e) => ({ error: e.message }))
  const local = (fetched.path ?? '').replace('file://', '')
  check('and is fetched from the file server when looked at', !!local && fs.existsSync(local) && fs.statSync(local).size > 0, JSON.stringify(fetched))
  const mine2 = path.join(out, 'from-moho.png')
  fs.writeFileSync(mine2, png)
  await rpc('sendMessage', { bufferId: general, body: 'a picture from moho', attachmentPaths: [mine2] })
  const theirs = await until('picture seen', async () => (await as('bob', 'GET', `/channels/${channel}/messages?limit=10`)).find((m) => m.content === 'a picture from moho' && m.attachments?.length))
  check('a picture alice sends is seen by bob', !!theirs && theirs.attachments[0].filename === 'from-moho.png')
  await rpc('sendMessage', { bufferId: general, body: 'hidden', attachmentPaths: [mine2], spoilerPaths: [mine2] })
  const spoiled = await until('spoiler seen', async () => (await as('bob', 'GET', `/channels/${channel}/messages?limit=10`)).find((m) => m.content === 'hidden' && m.attachments?.length))
  check('and one marked as a spoiler goes under the name Stoat reads as one', !!spoiled && /^SPOILER_/.test(spoiled.attachments[0].filename))

  await ev(`window.__mohoShots.store.refreshBuffers(); window.__mohoShots.store.selectBuffer(${JSON.stringify(general)})`)
  await sleep(800)
  await shot('stoat-local.png')
} finally {
  await stop()
  console.log(results.every(Boolean) ? 'ALL OK' : 'SOME FAILED')
  process.exitCode = results.every(Boolean) ? 0 : 1
}
