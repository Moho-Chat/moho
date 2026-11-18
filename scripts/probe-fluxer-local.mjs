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
import { accounts, as, sendFile, session, ORIGIN, API } from './lib/fluxer-local.mjs'

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
  // mohoa moderates here: a role that may pin, manage messages and moderate, made once and given to it.
  const PIN = 1n << 51n
  const MOD = PIN | (1n << 13n) | (1n << 1n) | (1n << 2n) | (1n << 40n) | (1n << 28n) | (1n << 4n) | (1n << 5n) | (1n << 7n) | (1n << 29n)
  const roles = await as('mohob', 'GET', `/guilds/${hall.id}/roles`)
  const modRole = roles.find((r) => r.name === 'Probe mods') ?? (await as('mohob', 'POST', `/guilds/${hall.id}/roles`, { name: 'Probe mods', permissions: MOD.toString() }))
  await as('mohob', 'PUT', `/guilds/${hall.id}/members/${acc.mohoa.user_id}/roles/${modRole.id}`).catch((e) => console.log('role:', e.message))

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

  // Search and pins.
  await as('mohob', 'POST', `/channels/${channel}/messages`, { content: `findable ${run} zebra` })
  const found = await until('search', async () => {
    try {
      const r = await rpc('searchStoatMessages', { bufferId: general, query: `zebra` })
      return r.results.find((m) => m.body.includes(`findable ${run}`)) ? r : null
    } catch (e) {
      return /indexing/.test(e.message) ? null : Promise.reject(e)
    }
  }, 45000)
  check('searching a channel finds what mohob said', !!found, JSON.stringify(found?.results?.slice(0, 2)))
  const toPin = (await rpc('getBacklog', { bufferId: general })).find((m) => m.body.includes(`findable ${run}`))
  await rpc('setPinned', { bufferId: general, messageId: toPin.id, pinned: true })
  const pinned = await until('pinned', async () => (await as('mohob', 'GET', `/channels/${channel}/messages/pins`)).items.some((p) => p.message.id === toPin.id))
  check('pinning in moho pins it on Fluxer', !!pinned)
  const listed = await rpc('listPinned', { bufferId: general }).catch((e) => ({ error: e.message }))
  check('and the pins are listed', JSON.stringify(listed).includes(toPin.id), JSON.stringify(listed).slice(0, 200))

  // An invite link is drawn as a card.
  const inviteCard = await as('mohob', 'POST', `/channels/${channel}/invites`, {})
  await as('mohob', 'POST', `/channels/${channel}/messages`, { content: `come along ${ORIGIN}/invite/${inviteCard.code} ${run}` })
  const carded = await until('card', async () => (await rpc('getBacklog', { bufferId: general })).find((m) => m.body.includes(`come along`) && m.body.includes(run) && m.embeds?.some((e) => e.kind === 'invite')))
  check('an invite link is drawn as a card for the community', !!carded, JSON.stringify(carded?.embeds?.find((e) => e.kind === 'invite')))

  // A custom emoji: offered in the picker, drawn in what mohob says, sent by name.
  const emojiName = `party${run.slice(-4)}`
  const emoji = await as('mohob', 'POST', `/guilds/${hall.id}/emojis`, { name: emojiName, image: `data:image/png;base64,${png.toString('base64')}` }).catch((e) => ({ error: e.message }))
  check('a custom emoji is made on the guild', !!emoji.id, JSON.stringify(emoji).slice(0, 200))
  const offered = await until('offered', async () => (await rpc('listAllEmoji', { bufferId: general })).find((src) => src.service === 'fluxer' && src.emoji.some((e) => e.name === emojiName)))
  check('it is offered in the picker under the guild’s name', offered?.name === 'Test Hall', JSON.stringify(offered && [offered.name, offered.emoji.length]))
  await as('mohob', 'POST', `/channels/${channel}/messages`, { content: `yay <:${emojiName}:${emoji.id}> ${run}` })
  const drawn = await until('drawn', async () => (await rpc('getBacklog', { bufferId: general })).find((m) => m.body.startsWith(`yay [fluxer:emoji:${emojiName}:`)))
  check('one in what mohob says is a picture token naming the cache', !!drawn && /fluxer-media\//.test(drawn.body), drawn?.body)
  await rpc('sendMessage', { bufferId: general, body: `back :${emojiName}: ${run}` })
  const sent = await until('sent', async () => (await as('mohob', 'GET', `/channels/${channel}/messages?limit=10`)).find((m) => m.content?.startsWith('back ') && m.content.includes(run)))
  check('what mohoa types by name goes out as the emoji', sent?.content === `back <:${emojiName}:${emoji.id}> ${run}`, sent?.content)

  // Read marks: reading the channel here marks it read on the account (seen in a fresh session's READY).
  const newest = (await as('mohob', 'GET', `/channels/${channel}/messages?limit=1`))[0]
  await rpc('markBufferRead', { bufferId: general })
  await sleep(1500)
  const look = await session('mohoa')
  const readState = look.events.find((e) => e.t === 'READY')?.d.read_states?.find((r) => r.id === channel)
  look.close()
  check('reading the channel in moho marks it read on the account', readState?.last_message_id === newest.id, JSON.stringify([readState?.last_message_id, newest.id]))

  // A second account, signed in by a code approved in another Fluxer app (here, mohob's own session), then removed.
  const codes = []
  await ev(`window.__fluxerNeeds = []; window.moho.onEvent((e) => { if (e.event === 'fluxerLoginNeeds') window.__fluxerNeeds.push(e.data) })`)
  await rpc('addFluxerAccountHandoff', { instance: ORIGIN })
  const need = await until('code', () => ev('window.__fluxerNeeds.find((n) => n.step === "handoff")'))
  check('a sign-in by code shows a code to type into another Fluxer app', /^[A-Z0-9]{6}-[A-Z0-9]{6}$/i.test(need?.code ?? ''), need?.code)
  if (need) {
    const plain = need.code.replace('-', '')
    codes.push(plain)
    await fetch(`${API}/auth/handoff/${plain}/info`).then((r) => r.text())
    const done = await fetch(`${API}/auth/handoff/complete`, { method: 'POST', headers: { Authorization: acc.mohob.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: plain, user_id: acc.mohob.user_id }) })
    check('mohob approves it', done.status === 204 || done.status === 200, String(done.status))
  }
  const bobAccount = `fluxer:${acc.mohob.user_id}`
  const bobIn = await until('bob in', async () => (await rpc('listAccounts')).find((a) => a.id === bobAccount && a.state === 'connected'), 30000)
  check('and moho is signed in as mohob without a password', !!bobIn)
  const before = (await as('mohob', 'GET', '/auth/sessions')).length
  await rpc('removeAccount', { accountId: bobAccount })
  const after = await until('session ended', async () => {
    const n = (await as('mohob', 'GET', '/auth/sessions')).length
    return n < before ? n : null
  })
  check('removing it ends the session moho made, and only that one', after === before - 1, `${before} -> ${after}`)

  // Moderating, as the role allows: mohoc is the one moderated.
  const powers = await rpc('getStoatPowers', { bufferId: general })
  check('the role lets mohoa kick, ban, time out and give roles', powers.canKick && powers.canBan && powers.canMute && powers.canAssignRoles, JSON.stringify(powers))
  const joinC = async () => {
    const inv = await as('mohob', 'POST', `/channels/${channel}/invites`, {})
    await as('mohoc', 'POST', `/invites/${inv.code}`, {})
  }
  const member = (id) => as('mohob', 'GET', `/guilds/${hall.id}/members/${id}`)
  await as('mohob', 'DELETE', `/guilds/${hall.id}/bans/${acc.mohoc.user_id}`).catch(() => {})
  await joinC().catch(() => {})
  await rpc('moderateStoatMember', { bufferId: general, userId: acc.mohoc.user_id, action: 'mute', minutes: 5 })
  check('a timeout is put on mohoc', !!(await member(acc.mohoc.user_id)).communication_disabled_until)
  await rpc('moderateStoatMember', { bufferId: general, userId: acc.mohoc.user_id, action: 'unmute' })
  check('and lifted', !(await member(acc.mohoc.user_id)).communication_disabled_until)
  const helpers = await as('mohob', 'POST', `/guilds/${hall.id}/roles`, { name: `Helpers ${run}`, permissions: '0' })
  await until('role heard', async () => (await rpc('getStoatPowers', { bufferId: general })).roles.some((r) => r.id === helpers.id))
  await rpc('setStoatMemberRole', { bufferId: general, userId: acc.mohoc.user_id, roleId: helpers.id, give: true })
  check('giving a role reaches Fluxer', (await member(acc.mohoc.user_id)).roles.includes(helpers.id))
  await rpc('setStoatMemberRole', { bufferId: general, userId: acc.mohoc.user_id, roleId: helpers.id, give: false })
  check('and taking it away does too', !(await member(acc.mohoc.user_id)).roles.includes(helpers.id))
  await rpc('moderateStoatMember', { bufferId: general, userId: acc.mohoc.user_id, action: 'kick' })
  check('kicking removes mohoc', await member(acc.mohoc.user_id).then(() => false, () => true))
  await joinC()
  await rpc('moderateStoatMember', { bufferId: general, userId: acc.mohoc.user_id, action: 'ban', reason: 'probe' })
  const banned = await as('mohob', 'GET', `/guilds/${hall.id}/bans/${acc.mohoc.user_id}`).catch(() => null)
  check('banning bars mohoc', !!banned)
  await rpc('moderateStoatMember', { bufferId: general, userId: acc.mohoc.user_id, action: 'unban' })
  check('and lifting the ban lets mohoc back', await as('mohob', 'GET', `/guilds/${hall.id}/bans/${acc.mohoc.user_id}`).then(() => false, () => true))
  const link = await rpc('createStoatInvite', { bufferId: general })
  check('an invite link is made on the instance’s invite address', /^http:\/\/localhost:8890\/invite\/[A-Za-z0-9]+$/.test(link.link), link.link)

  // Looking after the community, from its settings.
  const over = await rpc('stoatManage', { bufferId: general, action: 'overview' })
  check('the settings show the community, its categories, channels and roles', over.name === 'Test Hall' && over.categories.some((c) => c.title === 'Text channels') && over.channels.some((c) => c.id === channel) && over.roles.some((r) => r.name === 'Probe mods'), JSON.stringify([over.name, over.categories.map((c) => c.title), over.can]))
  const chName = `probe-${run}`
  await rpc('stoatManage', { bufferId: general, action: 'createChannel', name: chName })
  const made = (await as('mohob', 'GET', `/guilds/${hall.id}/channels`)).find((c) => c.name === chName)
  check('a channel is made', !!made)
  await rpc('stoatManage', { bufferId: general, action: 'editChannel', channelId: made.id, description: 'a topic', slowmode: 5 })
  const edited2 = (await as('mohob', 'GET', `/guilds/${hall.id}/channels`)).find((c) => c.id === made.id)
  check('and its topic and slowmode set', edited2?.topic === 'a topic' && edited2?.rate_limit_per_user === 5, JSON.stringify([edited2?.topic, edited2?.rate_limit_per_user]))
  const heads = (await rpc('stoatManage', { bufferId: general, action: 'overview' })).categories
  const moved = heads.map((h) => (h.title === 'Text channels' ? { ...h, channels: [...h.channels.filter((c) => c !== made.id), made.id] } : h))
  moved.push({ id: `new-${run}`, title: `Heading ${run}`, channels: [] })
  await rpc('stoatManage', { bufferId: general, action: 'setCategories', categories: moved })
  const after2 = await as('mohob', 'GET', `/guilds/${hall.id}/channels`)
  check('a new heading is made as a category', after2.some((c) => c.type === 4 && c.name === `Heading ${run}`))
  await rpc('stoatManage', { bufferId: general, action: 'setChannelPermissions', channelId: made.id, roleId: '', allow: [], deny: ['SEND_MESSAGES'] })
  const locked = (await as('mohob', 'GET', `/guilds/${hall.id}/channels`)).find((c) => c.id === made.id)
  check('who may write in a channel is changed for everybody', locked?.permission_overwrites?.some((o) => o.id === hall.id && (BigInt(o.deny) & (1n << 11n)) !== 0n), JSON.stringify(locked?.permission_overwrites))
  await rpc('stoatManage', { bufferId: general, action: 'editRole', roleId: helpers.id, name: `Helpers ${run}!`, colour: '#ff8800', hoist: true })
  const role2 = (await as('mohob', 'GET', `/guilds/${hall.id}/roles`)).find((r) => r.id === helpers.id)
  check('a role is renamed, coloured and hoisted', role2?.name === `Helpers ${run}!` && role2?.color === 0xff8800 && role2?.hoist === true, JSON.stringify(role2 && [role2.name, role2.color, role2.hoist]))
  await rpc('stoatManage', { bufferId: general, action: 'createWebhook', channelId: made.id, name: 'probe hook' })
  const hooks = await rpc('stoatManage', { bufferId: general, action: 'webhooks', channelId: made.id })
  check('a webhook is made and listed with its address', hooks.webhooks.some((w) => w.name === 'probe hook' && /\/webhooks\//.test(w.url ?? '')), JSON.stringify(hooks))
  for (const w of hooks.webhooks) await rpc('stoatManage', { bufferId: general, action: 'deleteWebhook', webhookId: w.id })
  check('and deleted', (await rpc('stoatManage', { bufferId: general, action: 'webhooks', channelId: made.id })).webhooks.length === 0)
  const audit = await rpc('stoatManage', { bufferId: general, action: 'auditLog' })
  check('the audit log reads in words', audit.entries.some((e) => /banned mohoc|kicked mohoc/.test(e.text)), JSON.stringify(audit.entries.slice(0, 4)))
  await rpc('stoatManage', { bufferId: general, action: 'deleteChannel', channelId: made.id })
  await rpc('stoatManage', { bufferId: general, action: 'deleteRole', roleId: helpers.id })
  await rpc('stoatManage', { bufferId: general, action: 'setCategories', categories: heads })
  const tidy = await as('mohob', 'GET', `/guilds/${hall.id}/channels`)
  check('a channel and a heading are deleted again', !tidy.some((c) => c.id === made.id || c.name === `Heading ${run}`))

  // Threads and a forum.
  const started = await as('mohob', 'POST', `/channels/${channel}/messages`, { content: `thread root ${run}` })
  const thread = await as('mohob', 'POST', `/channels/${channel}/messages/${started.id}/threads`, { name: `Thread ${run}` })
  const threads = await until('threads', async () => {
    const r = await rpc('listDiscordThreads', { bufferId: general })
    return r.threads.some((t) => t.id === thread.id) ? r : null
  })
  check('a channel’s threads are listed', !!threads, JSON.stringify(threads?.threads?.slice(0, 3)))
  const openedThread = await rpc('openDiscordThread', { bufferId: general, threadId: thread.id })
  check('opening one joins it and makes it a conversation', !!openedThread.bufferId && (await rpc('listBuffers')).some((b) => b.id === openedThread.bufferId && b.remoteId === thread.id), JSON.stringify(openedThread))
  await rpc('sendMessage', { bufferId: openedThread.bufferId, body: `in the thread ${run}` })
  const inThread = await until('in thread', async () => (await as('mohob', 'GET', `/channels/${thread.id}/messages?limit=5`)).find((m) => m.content === `in the thread ${run}`))
  check('and what is said in it reaches the thread', !!inThread)
  let forum = (await as('mohob', 'GET', `/guilds/${hall.id}/channels`)).find((c) => c.type === 15)
  if (!forum) forum = await as('mohob', 'POST', `/guilds/${hall.id}/channels`, { name: 'ideas', type: 15 })
  await as('mohob', 'POST', `/channels/${forum.id}/threads`, { name: `Post by mohob ${run}`, message: { content: `first words ${run}` } })
  const forumBuffer = await until('forum buffer', async () => (await rpc('listBuffers')).find((b) => b.accountId === account && b.remoteId === forum.id))
  check('a forum is a forum pane', forumBuffer?.forum === true, JSON.stringify(forumBuffer && [forumBuffer.name, forumBuffer.forum]))
  const posts = forumBuffer && (await until('posts', async () => {
    const r = await rpc('listForumPosts', { bufferId: forumBuffer.id, sort: 'active', offset: 0 })
    return r.posts.some((p) => p.name === `Post by mohob ${run}`) ? r : null
  }))
  check('its posts are listed with their first words', posts?.posts.some((p) => p.name === `Post by mohob ${run}` && p.content.includes(`first words ${run}`)), JSON.stringify(posts?.posts?.[0]))
  const posted = forumBuffer && (await rpc('createForumPost', { bufferId: forumBuffer.id, title: `Post from moho ${run}`, body: `hello forum ${run}`, tags: [] }))
  const seenPost = await until('post seen', async () => (await as('mohob', 'GET', `/channels/${forum.id}/threads/search?limit=10`)).threads.find((t) => t.name === `Post from moho ${run}`))
  check('a post made in moho is in the forum', !!seenPost && !!posted?.bufferId, JSON.stringify(posted))

  // The account's own profile.
  await rpc('setStoatProfile', { accountId: account, displayName: `Ada ${run.slice(-4)}`, pronouns: 'she/her', bio: `about ${run}` })
  const mine3 = await as('mohob', 'GET', `/users/${acc.mohoa.user_id}/profile`)
  check('the display name, pronouns and about text are set on the account', mine3.user.global_name === `Ada ${run.slice(-4)}` && mine3.user_profile.pronouns === 'she/her' && mine3.user_profile.bio === `about ${run}`, JSON.stringify([mine3.user.global_name, mine3.user_profile]))
  const read3 = await rpc('stoatOwnProfile', { accountId: account })
  check('and read back for the account tools', read3.displayName === `Ada ${run.slice(-4)}` && read3.handle === 'mohoa', JSON.stringify(read3))
  await rpc('setStoatProfile', { accountId: account, displayName: 'mohoa', pronouns: '', bio: '' })

  // A pasted token: signed in with it, and removing the account leaves that session alone (it is another app's).
  const cAccount = `fluxer:${acc.mohoc.user_id}`
  await rpc('addFluxerAccountToken', { instance: ORIGIN, token: acc.mohoc.token })
  check('a pasted token signs in', !!(await until('c in', async () => (await rpc('listAccounts')).find((a) => a.id === cAccount && a.state === 'connected'))))
  await rpc('removeAccount', { accountId: cAccount })
  await sleep(2000)
  check('and removing that account leaves its session working', !!(await as('mohoc', 'GET', '/users/@me').catch(() => null)))

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
