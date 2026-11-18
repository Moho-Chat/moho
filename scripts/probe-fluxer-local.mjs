#!/usr/bin/env node
/**
 * moho against the local self-hosted Fluxer, signed in as mohoa (by password, through the ALTCHA proof of work), with
 * mohob as the other person: what mohob does is seen, and what mohoa does in moho is seen from mohob's side.
 *
 *   ~/.local/share/moho-dev/fluxer-docker.sh start && cd /1tb/fluxer-test/bundle && DOCKER_HOST=unix:///run/docker-fluxer.sock docker compose up -d
 *   npx electron-vite build && node scripts/probe-fluxer-local.mjs <output directory>
 */
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, sleep } from './lib/harness.mjs'
import { accounts, as, sendFile, session, ORIGIN } from './lib/fluxer-local.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const acc = accounts()
// Messages carry this run's mark: the instance keeps earlier runs' history.
const run = Date.now().toString(36)
const bob = await session('mohob')
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
const until = async (what, fn, ms = 20000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    try {
      const v = await fn()
      if (v) return v
    } catch {
      /* not yet */
    }
    await sleep(300)
  }
  return null
}
try {
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  const guilds = await as('mohob', 'GET', '/users/@me/guilds')
  const hall = guilds.find((g) => g.name === 'Test Hall')
  const channels = await as('mohob', 'GET', `/guilds/${hall.id}/channels`)
  const channel = channels.find((c) => c.name === 'general').id

  // Signing in by password: the proof of work is done by the daemon.
  const { loginId } = await rpc('addFluxerAccount', { instance: ORIGIN, login: 'mohoa', password: 'moho-test-pass-1' })
  const account = `fluxer:${acc.mohoa.user_id}`
  const connected = await until('connected', async () => (await rpc('listAccounts')).find((a) => a.id === account && a.state === 'connected'), 60000)
  check('mohoa signs in by password (with the proof of work) and connects', !!connected, loginId)
  await ev(`window.__mohoShots?.store.refreshAccounts?.(); window.__mohoShots?.store.refreshBuffers?.()`)
  const buffers = await until('buffers', async () => {
    const b = (await rpc('listBuffers')).filter((x) => x.accountId === account)
    return b.some((x) => x.remoteId === channel) ? b : null
  })
  check('the guild and its channels are made', !!buffers, JSON.stringify(buffers?.map((b) => [b.name, b.category])))
  const general = buffers?.find((b) => b.remoteId === channel)?.id
  check('under their category', buffers?.find((b) => b.remoteId === channel)?.category === 'Text channels', buffers?.find((b) => b.remoteId === channel)?.category)
  const groups = await rpc('listBufferGroups')
  check('the guild is on the rail', groups.some((g) => g.accountId === account && g.name === 'Test Hall'))

  // mohob speaks.
  await rpc('getBacklog', { bufferId: general })
  await rpc('subscribe', { bufferId: general }).catch(() => {})
  await as('mohob', 'POST', `/channels/${channel}/messages`, { content: `hello from mohob ${run}, **bold** and <@${acc.mohoa.user_id}>` })
  const heard = await until('mohob heard', async () => (await rpc('getBacklog', { bufferId: general })).find((m) => m.body.includes(`hello from mohob ${run}`)))
  check('what mohob says is heard', !!heard, heard && JSON.stringify([heard.from, heard.body, heard.highlight]))
  check('with the mention said by name', /@mohoa/.test(heard?.body ?? ''))

  // mohoa speaks, in moho.
  await rpc('sendMessage', { bufferId: general, body: `hello from moho ${run}` })
  const seen = await until('mohoa seen', async () => (await as('mohob', 'GET', `/channels/${channel}/messages?limit=10`)).find((m) => m.content === `hello from moho ${run}`))
  check('what mohoa says in moho is seen by mohob', !!seen)
  const mine = (await rpc('getBacklog', { bufferId: general })).find((m) => m.body === `hello from moho ${run}`)
  await rpc('sendMessage', { bufferId: general, body: `a reply ${run}`, replyToId: heard?.id })
  const reply = await until('reply', async () => (await as('mohob', 'GET', `/channels/${channel}/messages?limit=10`)).find((m) => m.content === `a reply ${run}`))
  check('a reply names what it answers', reply?.message_reference?.message_id === heard?.id, JSON.stringify(reply?.message_reference))
  await rpc('editMessage', { bufferId: general, messageId: mine.id, body: `hello from moho (edited) ${run}` })
  const edited = await until('edited', async () => (await as('mohob', 'GET', `/channels/${channel}/messages/${mine.id}`)).content === `hello from moho (edited) ${run}`)
  check('an edit reaches mohob', !!edited)
  await rpc('toggleReaction', { bufferId: general, messageId: mine.id, emoji: '👍', add: true }).catch((e) => console.log('react:', e.message))
  const reacted = await until('reacted', async () => ((await as('mohob', 'GET', `/channels/${channel}/messages/${mine.id}`)).reactions ?? []).some((r) => r.emoji.name === '👍'))
  check('a reaction reaches mohob', !!reacted)
  await as('mohob', 'PUT', `/channels/${channel}/messages/${mine.id}/reactions/${encodeURIComponent('🔥')}/@me`)
  const flame = await until('flame', async () => (await rpc('getBacklog', { bufferId: general })).find((m) => m.id === mine.id)?.reactions?.some((r) => r.emoji === '🔥'))
  check('and mohob’s reaches moho', !!flame)
  await as('mohob', 'PATCH', `/channels/${channel}/messages/${heard.id}`, { content: `hello from mohob, changed ${run}` })
  const changed = await until('changed', async () => (await rpc('getBacklog', { bufferId: general })).find((m) => m.id === heard.id)?.body === `hello from mohob, changed ${run}`)
  check('mohob’s edit reaches moho', !!changed)
  await rpc('deleteMessage', { bufferId: general, messageId: mine.id })
  const gone = await until('gone', async () => !(await as('mohob', 'GET', `/channels/${channel}/messages?limit=10`)).some((m) => m.id === mine.id))
  check('a delete reaches mohob', !!gone)

  // Files, both ways.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  await sendFile('mohob', channel, `a picture ${run}`, 'dot.png', png, 'image/png')
  const pic = await until('picture heard', async () => (await rpc('getBacklog', { bufferId: general })).find((m) => m.body.startsWith(`a picture ${run}`) && m.attachments?.length))
  check('a picture mohob sends arrives as an attachment', !!pic && pic.attachments[0].kind === 'image', JSON.stringify(pic?.attachments?.[0]))
  const fetched = pic ? await rpc('restoreMedia', { path: pic.attachments[0].path }).catch((e) => ({ error: e.message })) : {}
  const local = (fetched.path ?? '').replace('file://', '')
  check('and is fetched from the media proxy when looked at', !!local && fs.existsSync(local) && fs.statSync(local).size > 0, JSON.stringify(fetched))
  const mine2 = path.join(out, 'from-moho.png')
  fs.writeFileSync(mine2, png)
  await rpc('sendMessage', { bufferId: general, body: `a picture from moho ${run}`, attachmentPaths: [mine2], spoilerPaths: [mine2] })
  const theirs = await until('picture seen', async () => (await as('mohob', 'GET', `/channels/${channel}/messages?limit=10`)).find((m) => m.content === `a picture from moho ${run}` && m.attachments?.length))
  check('a picture mohoa sends, as a spoiler, is seen by mohob', !!theirs && /^SPOILER_/.test(theirs.attachments[0].filename), JSON.stringify(theirs?.attachments?.[0]?.filename))

  // A direct message.
  const dm = await as('mohob', 'POST', '/users/@me/channels', { recipient_id: acc.mohoa.user_id })
  await as('mohob', 'POST', `/channels/${dm.id}/messages`, { content: `psst, a direct message ${run}` })
  const dmBuffer = await until('dm', async () => (await rpc('listBuffers')).find((b) => b.accountId === account && b.remoteId === dm.id))
  check('a direct message from mohob makes a conversation', !!dmBuffer, dmBuffer?.name)
  const dmHeard = dmBuffer && (await until('dm heard', async () => (await rpc('getBacklog', { bufferId: dmBuffer.id })).find((m) => m.body === `psst, a direct message ${run}`)))
  check('and its message is in it', !!dmHeard)

  // Who mohob is.
  await rpc('requestProfile', { bufferId: general, nick: 'mohob', userId: acc.mohob.user_id })
  const card = await until('profile', () => ev(`(() => { const p = window.__mohoShots.state().profile; return p && p.id === ${JSON.stringify(acc.mohob.user_id)} && !p.pending ? p : null })()`))
  check('mohob’s card says who he is, when the account was made and when he joined', !!card && card.handle === 'mohob' && !!card.createdTs && !!card.joinedTs, JSON.stringify(card && [card.name, card.handle, card.createdTs, card.joinedTs]))

  // Muting, both ways: from moho it reaches the account; from Fluxer's side it reaches moho.
  await rpc('setNotifyLevel', { bufferId: general, level: 'mute' })
  const settings = await until('muted at fluxer', async () => {
    const r = await fetch(`${ORIGIN}/api/v1/users/@me/guilds/${hall.id}/settings`, { method: 'PATCH', headers: { Authorization: acc.mohoa.token, 'Content-Type': 'application/json' }, body: '{}' }).then((x) => x.json())
    return r.channel_overrides?.[channel]?.muted ? r : null
  })
  check('muting a channel in moho mutes it on the account', !!settings)
  await fetch(`${ORIGIN}/api/v1/users/@me/guilds/${hall.id}/settings`, { method: 'PATCH', headers: { Authorization: acc.mohoa.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ channel_overrides: { [channel]: { collapsed: false, message_notifications: 0, muted: false, mute_config: null } } }) })
  const loud = await until('unmuted here', async () => (await rpc('listBuffers')).find((b) => b.id === general && b.notify === 'all'))
  check('and set to everything from another app, moho hears it', !!loud, JSON.stringify((await rpc('listBuffers')).find((b) => b.id === general)?.notify))

  // Friends: mohob asks, mohoa accepts in moho; then moho opens the conversation with him.
  await as('mohob', 'DELETE', `/users/@me/relationships/${acc.mohoa.user_id}`).catch(() => {})
  await as('mohob', 'POST', `/users/@me/relationships/${acc.mohoa.user_id}`, {})
  const asked = await until('request', async () => (await rpc('stoatFriendRequests', { accountId: account })).incoming.find((p) => p.id === acc.mohob.user_id))
  check('mohob’s friend request reaches the invitations', !!asked, JSON.stringify(asked))
  await rpc('answerStoatFriendRequest', { accountId: account, userId: acc.mohob.user_id, accept: true })
  const friends = await until('friends', async () => (await as('mohob', 'GET', '/users/@me/relationships')).find((r) => r.id === acc.mohoa.user_id && r.type === 1))
  check('and accepting it in moho makes them friends', !!friends)
  const opened = await rpc('openDirectMessage', { accountId: account, userId: acc.mohob.user_id })
  check('the conversation with mohob opens from moho', !!opened?.bufferId, JSON.stringify(opened))

  // Another community, joined by an invite link and left again.
  const other = await as('mohob', 'POST', '/guilds', { name: `Probe ${Date.now().toString(36)}` })
  const otherChannels = await as('mohob', 'GET', `/guilds/${other.id}/channels`)
  const text = otherChannels.find((c) => c.type === 0)
  const invite = await as('mohob', 'POST', `/channels/${text.id}/invites`, {})
  await rpc('joinBuffer', { accountId: account, name: `${ORIGIN}/invite/${invite.code}` })
  const joined = await until('joined', async () => (await rpc('listBufferGroups')).find((g) => g.accountId === account && g.name === other.name))
  check('a community joined by its invite link comes onto the rail', !!joined)
  if (joined) await rpc('leaveGroup', { groupId: joined.id })
  const left = await until('left', async () => !(await rpc('listBufferGroups')).some((g) => g.accountId === account && g.name === other.name))
  check('and leaving it takes it off again', !!left)
  await as('mohob', 'DELETE', `/guilds/${other.id}`).catch(() => {})

  // Typing, both ways.
  await as('mohob', 'POST', `/channels/${channel}/typing`)
  await ev(`window.__mohoShots.store.selectBuffer?.(${JSON.stringify(general)})`)
  await sleep(1500)
  await shot('fluxer-channel.png')
  check('a picture of the channel is taken', fs.existsSync(path.join(out, 'fluxer-channel.png')))
} catch (e) {
  console.log('probe stopped:', e.stack)
  results.push(false)
} finally {
  bob.close()
  await stop()
}
const failed = results.filter((r) => !r).length
console.log(failed ? `${failed} FAILED` : 'ALL OK')
process.exit(failed ? 1 : 0)
