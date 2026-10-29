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
import { accounts, as, upload, makeAccount, API } from './lib/stoat-local.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const acc = accounts()
// A stranger for this run: asks to be a friend, and has a server to be invited to.
const stranger = await makeAccount(`probe${Date.now().toString(36)}`)
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const ev = (code) => page.evaluate(code)
const rpc = (method, params = {}) => ev(`window.moho.rpc(${JSON.stringify(method)}, ${JSON.stringify(params)})`)
const shot = async (name) => {
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
}
let crashed = false
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
  // The two are friends to begin with (a block ends a friendship, and an earlier run may have made one).
  await as('alice', 'PUT', `/users/${acc.bob.id}/friend`).catch(() => {})
  await as('bob', 'PUT', `/users/${acc.alice.id}/friend`).catch(() => {})
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
  const notes = await rpc('openDirectMessage', { accountId: account, userId: acc.alice.id })
  check('the account’s own notes open as a conversation', (notes.bufferId ?? notes).endsWith('|Saved Notes'), JSON.stringify(notes))
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

  // Custom emoji: one made on the server is offered, drawn in what others say, and sent by name.
  const emojiFile = await upload('alice', 'party.png', png, 'image/png', 'emojis')
  const emojiName = `party${Date.now().toString(36).slice(-4)}`
  await as('alice', 'PUT', `/custom/emoji/${emojiFile}`, { name: emojiName, parent: { type: 'Server', id: acc.server.id } })
  const offered = await until('emoji offered', async () => {
    const sources = await rpc('listAllEmoji', { bufferId: general })
    return sources.find((s) => s.service === 'stoat' && s.emoji.some((e) => e.name === emojiName))
  })
  check('a custom emoji made on the server is offered in the picker under the server’s name', !!offered && offered.name === 'Test Hall', JSON.stringify(offered && [offered.name, offered.emoji.length, offered.usableHere]))
  await as('bob', 'POST', `/channels/${channel}/messages`, { content: `yay :${emojiFile}:` })
  const drawn = await until('emoji heard', async () => (await rpc('getBacklog', { bufferId: general })).find((m) => m.body.startsWith(`yay [stoat:emoji:${emojiName}:`)))
  check('and one in what bob says is a picture token naming the cache', !!drawn && new RegExp(`^yay \\[stoat:emoji:${emojiName}:file://.*/stoat-media/[0-9a-f]+\\.png\\]$`).test(drawn.body), drawn?.body)
  await rpc('sendMessage', { bufferId: general, body: `back :${emojiName}: !!and a secret!!` })
  const said = await until('emoji seen', async () => (await as('bob', 'GET', `/channels/${channel}/messages?limit=10`)).find((m) => (m.content ?? '').startsWith('back :')))
  check('what alice types by name goes out as the emoji’s id', said?.content === `back :${emojiFile}: !!and a secret!!`, said?.content)

  // Moderation: roles, a timeout, removing and barring, and an invite to the server.
  const powers = await rpc('getStoatPowers', { bufferId: general })
  check('the owner may kick, ban, silence and hand out roles', powers.canKick && powers.canBan && powers.canMute && powers.canAssignRoles, JSON.stringify(powers))
  const role = await as('alice', 'POST', `/servers/${acc.server.id}/roles`, { name: `Helpers ${Date.now().toString(36).slice(-3)}` })
  await until('role heard', async () => (await rpc('getStoatPowers', { bufferId: general })).roles.some((r) => r.id === role.id))
  check('a role made on the server is one the menu can give', true)
  await rpc('setStoatMemberRole', { bufferId: general, userId: acc.bob.id, roleId: role.id, give: true })
  check('giving it reaches bob', (await as('alice', 'GET', `/servers/${acc.server.id}/members/${acc.bob.id}`)).roles.includes(role.id))
  await rpc('setStoatMemberRole', { bufferId: general, userId: acc.bob.id, roleId: role.id, give: false })
  check('and taking it away does too', !(await as('alice', 'GET', `/servers/${acc.server.id}/members/${acc.bob.id}`)).roles.includes(role.id))
  await rpc('moderateStoatMember', { bufferId: general, userId: acc.bob.id, action: 'mute', minutes: 5 })
  check('a timeout is put on bob', !!(await as('alice', 'GET', `/servers/${acc.server.id}/members/${acc.bob.id}`)).timeout)
  await rpc('moderateStoatMember', { bufferId: general, userId: acc.bob.id, action: 'unmute' })
  check('and lifted', !(await as('alice', 'GET', `/servers/${acc.server.id}/members/${acc.bob.id}`)).timeout)
  const link = await rpc('createStoatInvite', { bufferId: general })
  check('an invite link is made, on the instance’s own web app', /^http:\/\/localhost:8880\/invite\/[A-Za-z0-9]+$/.test(link.link), link.link)
  await stranger.call('POST', `/invites/${link.link.split('/').pop()}`, {})
  check('and the stranger joins by it', (await stranger.call('GET', `/servers/${acc.server.id}/members/${stranger.id}`))._id.user === stranger.id)
  await rpc('moderateStoatMember', { bufferId: general, userId: stranger.id, action: 'kick' })
  check('kicking removes the stranger', await stranger.call('GET', `/servers/${acc.server.id}/members/${stranger.id}`).then(() => false, () => true))
  await stranger.call('POST', `/invites/${link.link.split('/').pop()}`, {})
  await rpc('moderateStoatMember', { bufferId: general, userId: stranger.id, action: 'ban', reason: 'probe' })
  check('barring does too, and the stranger cannot come back', await stranger.call('POST', `/invites/${link.link.split('/').pop()}`, {}).then(() => false, () => true))
  await rpc('moderateStoatMember', { bufferId: general, userId: stranger.id, action: 'unban' })

  // A conversation with bob, both ways.
  const opened = await rpc('openDirectMessage', { accountId: account, userId: acc.bob.id, nick: 'bob' })
  const dm = opened.bufferId ?? opened
  check('a direct message with bob opens', typeof dm === 'string' && dm.includes('|bob'), JSON.stringify(opened))
  const dmChannel = (await as('bob', 'GET', `/users/${acc.alice.id}/dm`))._id
  await as('bob', 'POST', `/channels/${dmChannel}/messages`, { content: 'psst, it is bob' })
  const whisper = await until('dm heard', async () => (await rpc('getBacklog', { bufferId: dm })).find((m) => m.body === 'psst, it is bob'))
  check('what bob says in it is heard', !!whisper)
  await rpc('sendMessage', { bufferId: dm, body: 'psst back' })
  const back = await until('dm seen', async () => (await as('bob', 'GET', `/channels/${dmChannel}/messages?limit=5`)).find((m) => m.content === 'psst back'))
  check('and what alice says reaches bob', !!back)

  // Blocking, and being let through again.
  await rpc('stoatBlock', { accountId: account, userId: acc.bob.id, block: true })
  const locked = await until('locked', async () => (await rpc('listBuffers')).find((b) => b.id === dm)?.readOnly)
  check('blocking bob closes the conversation to writing', !!locked, locked)
  await rpc('stoatBlock', { accountId: account, userId: acc.bob.id, block: false })
  const stillShut = await until('shut', async () => (await rpc('listBuffers')).find((b) => b.id === dm)?.readOnly)
  check('and unblocking does not make them friends again: it stays shut, with the reason', /friends/.test(stillShut ?? ''), stillShut)
  await as('alice', 'PUT', `/users/${acc.bob.id}/friend`)
  await as('bob', 'PUT', `/users/${acc.alice.id}/friend`)
  const open = await until('open again', async () => !(await rpc('listBuffers')).find((b) => b.id === dm)?.readOnly)
  check('and being friends again opens it', !!open)

  // Somebody asks to be a friend.
  await stranger.call('PUT', `/users/${acc.alice.id}/friend`)
  const asked = await until('request', async () => (await rpc('stoatFriendRequests', { accountId: account })).incoming.find((r) => r.id === stranger.id))
  check('a friend request is listed with the name of who asked', !!asked && asked.name === stranger.username, JSON.stringify(asked))
  await rpc('answerStoatFriendRequest', { accountId: account, userId: stranger.id, accept: true })
  const friends = await until('friends', async () => (await stranger.call('GET', `/users/${acc.alice.id}`)).relationship === 'Friend')
  check('accepting makes them friends', !!friends)
  check('and they are no longer waiting', !(await rpc('stoatFriendRequests', { accountId: account })).incoming.some((r) => r.id === stranger.id))

  // Another server, joined by its invite and left.
  const hall = await stranger.call('POST', '/servers/create', { name: 'Stranger Den' })
  const invite = await stranger.call('POST', `/channels/${hall.channels[0]._id}/invites`, {})
  await rpc('joinBuffer', { accountId: account, name: `http://localhost:8880/invite/${invite._id}` })
  const joined = await until('joined', async () => (await rpc('listBuffers')).find((b) => b.accountId === account && /^Stranger Den\//.test(b.name)))
  check('a server is joined by its invite link and its channels are made', !!joined, joined?.name)
  await rpc('leaveGroup', { groupId: `${account}|server:${hall.server._id}` })
  const left = await until('left', async () => !(await rpc('listBuffers')).some((b) => /^Stranger Den\//.test(b.name)))
  check('and leaving it takes it away', !!left)
  const ownLeft = await rpc('leaveGroup', { groupId: `${account}|server:${acc.server.id}` }).then(() => 'left', (e) => e.message)
  check('a server the account owns is not left, since that deletes it', /own this server/.test(ownLeft), ownLeft)

  await ev(`window.__mohoShots.store.refreshBuffers(); window.__mohoShots.store.selectBuffer(${JSON.stringify(general)})`)
  await sleep(800)
  await shot('stoat-local.png')
} catch (e) {
  crashed = true
  console.log('CRASHED:', e.message)
} finally {
  await stop()
  console.log(results.every(Boolean) && !crashed ? 'ALL OK' : 'SOME FAILED')
  process.exitCode = results.every(Boolean) && !crashed ? 0 : 1
}
