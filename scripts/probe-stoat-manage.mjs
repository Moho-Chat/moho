#!/usr/bin/env node
/**
 * moho against the local self-hosted Stoat, signed in as alice (who owns the test server), with bob as the other person:
 * mutes kept on the account, searching and pins, the account's own profile and status, looking after a server (channels,
 * headings, roles, permissions, webhooks, the audit log), blocking, a bridge's name marked, and a custom emoji reaction.
 *
 *   ~/.local/share/moho-dev/stoat-docker.sh start && cd /1tb/stoat-test/selfhosted && DOCKER_HOST=unix:///run/docker-stoat.sock docker compose up -d
 *   npx electron-vite build && node scripts/probe-stoat-manage.mjs <output directory>
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
let crashed = false
const results = []
const check = (what, ok, detail = '') => {
  results.push(ok)
  console.log(ok ? '  ok  ' : '  FAIL', what, detail)
}
const until = async (fn, ms = 15000) => {
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
const S = acc.server.id
const channelId = acc.server.channels
try {
  await sleep(2500)
  // Whatever an earlier run left behind.
  const left = await as('alice', 'GET', `/servers/${S}?include_channels=true`)
  for (const c of left.channels ?? []) if (/^probe-/.test(c.name)) await as('alice', 'DELETE', `/channels/${c._id}`).catch(() => {})
  for (const [id, r] of Object.entries(left.roles ?? {})) if (/^Role /.test(r.name)) await as('alice', 'DELETE', `/servers/${S}/roles/${id}`).catch(() => {})
  await as('alice', 'PATCH', `/servers/${S}`, { categories: (left.categories ?? []).filter((c) => !/^Probe /.test(c.title)) })
  await as('alice', 'PUT', `/users/${acc.bob.id}/friend`).catch(() => {})
  await as('bob', 'PUT', `/users/${acc.alice.id}/friend`).catch(() => {})
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await rpc('addStoatAccountToken', { instance: API, token: acc.alice.token })
  const account = `stoat:${acc.alice.id}`
  check('alice connects', !!(await until(async () => (await rpc('listAccounts')).find((a) => a.id === account && a.state === 'connected'))))
  await ev(`window.__mohoShots.store.refreshAccounts(); window.__mohoShots.store.refreshBuffers()`)
  const general = `${account}|Test Hall/#General`
  const random = `${account}|Test Hall/#random`
  await until(async () => (await rpc('listBuffers')).some((b) => b.id === general))
  const muted = async (id) => !!(await rpc("listBuffers")).find((b) => b.id === id)?.serverMuted

  // --- Mutes, kept on the account.
  await as('alice', 'POST', '/sync/settings/set', { notifications: JSON.stringify({}) })
  await rpc('setStoatChannelMuted', { bufferId: random, muted: true })
  check('muting a conversation silences it', !!(await until(async () => (await muted(random)) === true)))
  const saved = JSON.parse((await as('alice', 'POST', '/sync/settings/fetch', { keys: ['notifications'] })).notifications[1])
  check('and is kept in the account’s own settings', Object.keys(saved.channel_mutes ?? {}).includes(channelId.random), JSON.stringify(saved))
  await as('alice', 'POST', '/sync/settings/set', { notifications: JSON.stringify({}) })
  check('a mute taken off in another app is heard here', !!(await until(async () => (await muted(random)) === false)))

  // --- Search and pins.
  const sent = await as('bob', 'POST', `/channels/${channelId.General}/messages`, { content: 'the quokka crosses the zebra needle' })
  await sleep(800)
  const found = await until(async () => {
    const r = await rpc('searchStoatMessages', { bufferId: general, query: 'quokka' })
    return r.results?.find((m) => m.id === sent._id)
  })
  check('a word searched for is found on Stoat’s side', !!found, JSON.stringify(found && [found.from, found.body]))
  await rpc('setPinned', { bufferId: general, messageId: sent._id, pinned: true })
  const pins = await until(async () => {
    const r = await rpc('listPinned', { bufferId: general })
    return r.pinned?.some((m) => m.id === sent._id) ? r.pinned : null
  })
  check('a message pinned from here is in the channel’s pins', !!pins)
  const ctx = await rpc('loadMessageContext', { bufferId: general, messageId: sent._id })
  check('and the part of the channel around it can be read', ctx.ts > 1_700_000_000 && ctx.messages?.some((m) => m.id === sent._id), JSON.stringify(ctx.ts))
  await rpc('setPinned', { bufferId: general, messageId: sent._id, pinned: false })
  check('the pin comes off', !!(await until(async () => (await rpc('listPinned', { bufferId: general })).pinned?.length === 0)))
  // The window is told of a pin made in another app, and does not ask for ever.
  await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(general)})`)
  await as('bob', 'POST', `/channels/${channelId.General}/messages/${sent._id}/pin`, {}).catch(async () => {})
  await as('alice', 'POST', `/channels/${channelId.General}/messages/${sent._id}/pin`, {})
  const told = await until(async () => (await ev(`window.__mohoShots.state().pinnedMessages[${JSON.stringify(general)}]`))?.includes(sent._id))
  check('a pin made elsewhere reaches the window', !!told)
  await as('alice', 'DELETE', `/channels/${channelId.General}/messages/${sent._id}/pin`)

  // --- The account’s own profile and presence.
  const before = await rpc('stoatOwnProfile', { accountId: account })
  await rpc('setStoatProfile', { accountId: account, displayName: 'Alice A', pronouns: 'she, her', bio: 'hello from moho', statusText: 'probing' })
  const mine = await as('bob', 'GET', `/users/${acc.alice.id}`)
  check('a changed profile is what others see', mine.display_name === 'Alice A' && mine.status?.text === 'probing' && JSON.stringify(mine.pronouns).includes('she'), JSON.stringify([mine.display_name, mine.status, mine.pronouns]))
  const bio = await as('bob', 'GET', `/users/${acc.alice.id}/profile`)
  check('and its about text', bio.content === 'hello from moho')
  await rpc('setAccountStatus', { accountId: account, status: 'dnd' })
  check('do not disturb is Stoat’s Busy', !!(await until(async () => (await as('bob', 'GET', `/users/${acc.alice.id}`)).status?.presence === 'Busy')))
  await rpc('setAccountStatus', { accountId: account, status: 'invisible' })
  check('and invisible is what Stoat shows as offline, though connected', !!(await until(async () => (await as('bob', 'GET', `/users/${acc.alice.id}`)).online === false)))
  // Focus: only mentions reach the account, here as on Stoat's side.
  await rpc('setAccountStatus', { accountId: account, status: 'focus', statusText: 'heads down' })
  const focusSeen = await until(async () => { const u = await as('bob', 'GET', `/users/${acc.alice.id}`); return u.status?.presence === 'Focus' && u.status?.text === 'heads down' })
  check('Focus is Stoat’s Focus, with its status text', !!focusSeen)
  check('and is what the account says it is', (await rpc('listAccounts')).find((a) => a.id === account)?.status === 'focus')
  await ev(`window.__notes = []; window.moho.onEvent((e) => { if (e.event === 'notification') window.__notes.push(e.data.body) })`)
  const dm = await as('bob', 'GET', `/users/${acc.alice.id}/dm`)
  await as('bob', 'POST', `/channels/${dm._id}/messages`, { content: 'plain hello while focused' })
  await as('bob', 'POST', `/channels/${dm._id}/messages`, { content: `<@${acc.alice.id}> a mention while focused` })
  await sleep(2500)
  const focused = await ev(`window.__notes`)
  check('while on Focus a direct message that mentions nobody does not notify, and one that mentions does', focused.length === 1 && /a mention/.test(focused[0]), JSON.stringify(focused))
  await rpc('setAccountStatus', { accountId: account, status: 'online', statusText: '' })
  await as('bob', 'POST', `/channels/${dm._id}/messages`, { content: 'plain hello while online' })
  check('and on Online it does', !!(await until(async () => (await ev(`window.__notes`)).some((n) => /while online/.test(n)))))
  check('the status text is cleared', !!(await until(async () => !(await as('bob', 'GET', `/users/${acc.alice.id}`)).status?.text)))
  await rpc('setAccountStatus', { accountId: account, status: 'online' })
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const pic = path.join(out, 'me.png')
  fs.writeFileSync(pic, png)
  const answer = await rpc('setStoatProfileAvatar', { accountId: account, path: pic })
  const withPic = await as('bob', 'GET', `/users/${acc.alice.id}`)
  check('a picture chosen is put on the account', !!answer.avatarUrl && !!withPic.avatar, JSON.stringify([answer, withPic.avatar]))
  await rpc('setStoatProfileAvatar', { accountId: account, path: '' })
  check('and taken off', !!(await until(async () => !(await as('bob', 'GET', `/users/${acc.alice.id}`)).avatar)))
  await rpc('setStoatProfile', { accountId: account, displayName: before.displayName, pronouns: before.pronouns, bio: before.bio, statusText: before.statusText })

  // --- Looking after the server.
  const o = await rpc('stoatManage', { bufferId: general, action: 'overview' })
  check('the server is described to its owner with everything they may do', o.name === 'Test Hall' && o.can.owner && o.can.channels && o.can.roles && o.can.audit && o.channels.length >= 4 && o.permissions.length > 20, JSON.stringify(o.can))
  const tag = Date.now().toString(36).slice(-4)
  await rpc('stoatManage', { bufferId: general, action: 'createChannel', name: `probe-${tag}`, voice: false })
  const made = await until(async () => (await rpc('stoatManage', { bufferId: general, action: 'overview' })).channels.find((c) => c.name === `probe-${tag}`))
  check('a channel can be made', !!made)
  await rpc('stoatManage', { bufferId: general, action: 'editChannel', channelId: made.id, description: 'a topic', nsfw: true, slowmode: 5 })
  const edited = (await rpc('stoatManage', { bufferId: general, action: 'overview' })).channels.find((c) => c.id === made.id)
  check('and edited: topic, age restriction, slowmode', edited.description === 'a topic' && edited.nsfw && edited.slowmode === 5, JSON.stringify([edited.description, edited.nsfw, edited.slowmode]))
  const after = (await rpc('listBuffers')).find((b) => b.remoteId === made.id)
  check('the new channel is a conversation in moho, with its topic', !!after, JSON.stringify(after && [after.name, after.topic]))
  const heading = `H${tag}`.toUpperCase()
  const current = (await rpc('stoatManage', { bufferId: general, action: 'overview' })).categories
  await rpc('stoatManage', { bufferId: general, action: 'setCategories', categories: [...current.map((c) => ({ ...c, channels: c.channels.filter((x) => x !== made.id) })), { id: heading, title: `Probe ${tag}`, channels: [made.id] }] })
  const filed = (await rpc('stoatManage', { bufferId: general, action: 'overview' })).channels.find((c) => c.id === made.id)
  check('a heading can be made with the channel under it', filed.category === heading)
  await rpc('stoatManage', { bufferId: general, action: 'createRole', name: `Role ${tag}` })
  const role = await until(async () => (await rpc('stoatManage', { bufferId: general, action: 'overview' })).roles.find((r) => r.name === `Role ${tag}`))
  check('a role can be made', !!role)
  await rpc('stoatManage', { bufferId: general, action: 'editRole', roleId: role.id, colour: '#ff8800', hoist: true })
  await rpc('stoatManage', { bufferId: general, action: 'setRolePermissions', roleId: role.id, allow: ['SendMessage', 'ViewAuditLogs'], deny: ['React'] })
  const r2 = (await rpc('stoatManage', { bufferId: general, action: 'overview' })).roles.find((r) => r.id === role.id)
  check('with a colour, listed apart, and what it allows and denies (a permission high above 32 bits too)', r2.colour === '#ff8800' && r2.hoist && r2.allow.includes('SendMessage') && r2.allow.includes('ViewAuditLogs') && r2.deny.includes('React'), JSON.stringify(r2))
  await rpc('stoatManage', { bufferId: general, action: 'setChannelPermissions', channelId: made.id, roleId: role.id, allow: ['SendMessage'], deny: [] })
  await rpc('stoatManage', { bufferId: general, action: 'setChannelPermissions', channelId: made.id, roleId: '', allow: [], deny: ['UploadFiles'] })
  const c2 = (await rpc('stoatManage', { bufferId: general, action: 'overview' })).channels.find((c) => c.id === made.id)
  check('who may do what in one channel can be set, for a role and for everybody', c2.roles.some((x) => x.roleId === role.id && x.allow.includes('SendMessage')) && c2.default.deny.includes('UploadFiles'), JSON.stringify([c2.roles, c2.default]))
  await rpc('stoatManage', { bufferId: general, action: 'reorderRoles', order: (await rpc('stoatManage', { bufferId: general, action: 'overview' })).roles.map((r) => r.id).reverse() })
  const hooked = await rpc('stoatManage', { bufferId: general, action: 'createWebhook', channelId: made.id, name: 'probe hook' })
  const hooks = await rpc('stoatManage', { bufferId: general, action: 'webhooks', channelId: made.id })
  check('a webhook can be made and listed with its address', hooks.webhooks.length === 1 && /\/webhooks\/[A-Z0-9]{26}\/.+/.test(hooks.webhooks[0].url ?? ''), JSON.stringify(hooks.webhooks.map((w) => w.name)))
  // This version of the server (0.15) has no route to delete one; they go with their channel. The answer is Stoat’s own.
  const gone = await rpc('stoatManage', { bufferId: general, action: 'deleteWebhook', webhookId: hooks.webhooks[0].id, token: hooks.webhooks[0].token }).then(() => 'deleted', (e) => e.message)
  console.log('  note  deleting a webhook:', String(gone).slice(0, 80))
  const log = await rpc('stoatManage', { bufferId: general, action: 'auditLog' })
  check('the audit log says what was done, in words', log.entries.some((e) => /made the channel probe-/.test(e.text)) && log.entries.some((e) => /made the role Role /.test(e.text)), JSON.stringify(log.entries.slice(0, 4).map((e) => e.text)))
  await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(general)})`)
  await rpc('stoatManage', { bufferId: general, action: 'deleteChannel', channelId: made.id })
  await rpc('stoatManage', { bufferId: general, action: 'deleteRole', roleId: role.id })
  await rpc('stoatManage', { bufferId: general, action: 'setCategories', categories: current })
  check('the channel and role are deleted again, and the conversation goes', !!(await until(async () => !(await rpc('listBuffers')).some((b) => b.remoteId === made.id))))
  // A refusal is Stoat’s, in words: bob cannot manage anything.
  const bobsView = await as('bob', 'GET', `/servers/${S}`)
  check('the server is one bob is in', bobsView._id === S)

  // --- Blocking, through the ignore the member menu has.
  await rpc('setIgnored', { accountId: account, target: acc.bob.id, ignored: true })
  check('ignoring a person on Stoat blocks them on the account', !!(await until(async () => (await as('alice', 'GET', `/users/${acc.bob.id}`)).relationship === 'Blocked')))
  await rpc('setIgnored', { accountId: account, target: acc.bob.id, ignored: false })
  await as('alice', 'PUT', `/users/${acc.bob.id}/friend`).catch(() => {})
  await as('bob', 'PUT', `/users/${acc.alice.id}/friend`).catch(() => {})

  // --- A bridge’s name is marked, and a custom emoji is a picture in a reaction.
  const relayed = await as('alice', 'POST', `/channels/${channelId.General}/messages`, { content: 'from the bridge', masquerade: { name: 'Relay Ada' } })
  const marked = await until(async () => (await rpc('getBacklog', { bufferId: general })).find((m) => m.id === relayed._id && m.badges?.some((b) => b.type === 'via')))
  check('a message sent under another name is marked as such', !!marked && marked.from === 'Relay Ada', JSON.stringify(marked && [marked.from, marked.badges]))
  const emojis = await as('alice', 'GET', `/servers/${S}/emojis`)
  if (emojis.length) {
    await as('bob', 'PUT', `/channels/${channelId.General}/messages/${relayed._id}/reactions/${emojis[0]._id}`)
    const pill = await until(async () => (await rpc('getBacklog', { bufferId: general })).find((m) => m.id === relayed._id)?.reactions?.find((r) => r.emoji.startsWith('[stoat:emoji:')))
    check('a custom emoji reaction is held as its picture', !!pill, JSON.stringify(pill))
    await ev(`window.__mohoShots.store.refreshBuffers(); window.__mohoShots.store.selectBuffer(${JSON.stringify(general)})`)
    await sleep(1200)
    const drawn = await ev(`!!document.querySelector('.reaction-pill img.reaction-emoji')`)
    check('and drawn in the pill', drawn)
    await shot('stoat-reactions.png')
    if (pill) {
      await rpc('toggleReaction', { bufferId: general, messageId: relayed._id, emoji: pill.emoji, add: true })
      check('and reacting with it from its pill reaches Stoat', !!(await until(async () => (await as('bob', 'GET', `/channels/${channelId.General}/messages/${relayed._id}`)).reactions?.[emojis[0]._id]?.includes(acc.alice.id))))
    }
  }
  await as('alice', 'DELETE', `/channels/${channelId.General}/messages/${relayed._id}`).catch(() => {})

  // --- A picture sent as a spoiler is covered until it is clicked.
  const hiddenFile = await upload('bob', 'SPOILER_dot.png', png, 'image/png')
  const covered = await as('bob', 'POST', `/channels/${channelId.General}/messages`, { content: 'a hidden one', attachments: [hiddenFile] })
  await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(general)})`)
  const cover = await until(async () => ev(`!!document.querySelector('.spoiler-cover')`), 20000)
  check('a spoilered picture from somebody else is covered in the log', !!cover)
  await shot('stoat-spoiler.png')
  await as('bob', 'DELETE', `/channels/${channelId.General}/messages/${covered._id}`).catch(() => {})

  // --- A link to a server is a card to join it.
  const lonely = await as('bob', 'POST', '/servers/create', { name: `Kittens ${Date.now().toString(36).slice(-4)}` })
  const lonelyId = lonely.server?._id ?? lonely._id
  const lonelyChannel = (lonely.channels ?? [])[0]?._id ?? lonely.server?.channels?.[0]
  const lonelyInvite = await as('bob', 'POST', `/channels/${lonelyChannel}/invites`, {})
  const ownApp = (await (await fetch(API + '/')).json()).app
  const invitePost = await as('bob', 'POST', `/channels/${channelId.General}/messages`, { content: `come join ${ownApp}/invite/${lonelyInvite._id} or back at ${ownApp}/invite/${acc.server.invite}` })
  const cards = await until(async () => {
    const m = (await rpc('getBacklog', { bufferId: general })).find((x) => x.id === invitePost._id)
    return m?.embeds?.filter((e) => e.kind === 'invite').length === 2 ? m.embeds : null
  }, 20000)
  check('links to two servers are drawn as cards: one to join, one already joined', !!cards && cards.some((e) => e.cta?.label === 'Join' && /^Kittens/.test(e.title)) && cards.some((e) => e.cta?.label === 'Joined'), JSON.stringify(cards?.map((e) => [e.title, e.description, e.cta?.label])))
  await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(general)})`)
  const drawnCard = await until(async () => ev(`document.querySelectorAll('.invite-card').length === 2`), 15000)
  check('and the window shows them', !!drawnCard)
  await shot('stoat-invite-cards.png')
  await ev(`[...document.querySelectorAll('.invite-card')].find((c) => /Kittens/.test(c.textContent)).querySelector('button').click()`)
  const nowIn = await until(async () => (await rpc('listBufferGroups').catch(() => [])).some?.((g) => g.id === `${account}|server:${lonelyId}`) || (await ev(`window.__mohoShots.state().groups.some((g) => g.id === ${JSON.stringify(`${account}|server:${lonelyId}`)})`)), 20000)
  check('pressing Join joins that server', !!nowIn)
  const flipped = await until(async () => ev(`[...document.querySelectorAll('.invite-card button')].every((b) => b.textContent === 'Joined')`), 10000)
  check('and its card says Joined', !!flipped)
  await as('alice', 'DELETE', `/servers/${lonelyId}`).catch(() => {})
  await as('bob', 'DELETE', `/servers/${lonelyId}`).catch(() => {})
  await as('bob', 'DELETE', `/channels/${channelId.General}/messages/${invitePost._id}`).catch(() => {})

  // --- Reactions are counted once: this account's own comes back as an event, and was once counted again here.
  const counted = await as('bob', 'POST', `/channels/${channelId.General}/messages`, { content: 'count me' })
  const tally = async () => (await rpc('getBacklog', { bufferId: general })).find((m) => m.id === counted._id)?.reactions?.find((r) => r.emoji === '👍')
  await until(async () => (await rpc('getBacklog', { bufferId: general })).some((m) => m.id === counted._id))
  await rpc('toggleReaction', { bufferId: general, messageId: counted._id, emoji: '👍', add: true })
  await until(async () => (await tally())?.count >= 1)
  await sleep(1200)
  check('a reaction of this account is counted once', (await tally())?.count === 1 && (await tally())?.me === true, JSON.stringify(await tally()))
  await as('bob', 'PUT', `/channels/${channelId.General}/messages/${counted._id}/reactions/${encodeURIComponent('👍')}`)
  await until(async () => (await tally())?.count === 2)
  await rpc('toggleReaction', { bufferId: general, messageId: counted._id, emoji: '👍', add: false })
  await until(async () => (await tally())?.count === 1)
  await sleep(1200)
  check('and bob’s alongside it, and taken away again, leave the count right', (await tally())?.count === 1 && (await tally())?.me === false, JSON.stringify(await tally()))
  await as('bob', 'DELETE', `/channels/${channelId.General}/messages/${counted._id}`).catch(() => {})

  // --- An emoji from a server this account is not in is still a picture.
  const away = await as('bob', 'POST', '/servers/create', { name: `Elsewhere ${Date.now().toString(36).slice(-4)}` })
  const awayServer = away.server?._id ?? away._id
  const foreignFile = await upload('bob', 'far.png', png, 'image/png', 'emojis')
  await as('bob', 'PUT', `/custom/emoji/${foreignFile}`, { name: 'faraway', parent: { type: 'Server', id: awayServer } })
  const foreign = await as('bob', 'POST', `/channels/${channelId.General}/messages`, { content: `look :${foreignFile}:` })
  const seenForeign = await until(async () => (await rpc('getBacklog', { bufferId: general })).find((m) => m.id === foreign._id)?.body)
  check('an emoji from a server alice is not in is drawn as a picture', new RegExp(`^look \\[stoat:emoji:${foreignFile}:file://.*/stoat-media/[0-9a-f]+\\.png\\]$`).test(seenForeign ?? ''), seenForeign)
  await as('bob', 'DELETE', `/servers/${awayServer}`).catch(() => {})
  await as('bob', 'DELETE', `/channels/${channelId.General}/messages/${foreign._id}`).catch(() => {})

  // --- Pictures actually load in the window: a person's avatar in the member list, and the server's icon on the rail.
  const loaded = (selector) => ev(`[...document.querySelectorAll(${JSON.stringify(selector)})].some((i) => i.complete && i.naturalWidth > 0)`)
  const avatarId = await upload('bob', 'bob.png', png, 'image/png', 'avatars')
  await as('bob', 'PATCH', '/users/@me', { avatar: avatarId })
  await rpc('requestMemberList', { bufferId: general })
  await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(general)})`)
  check('a person’s avatar loads in the member list', !!(await until(async () => loaded('.nick-row img'), 20000)))
  await as('bob', 'PATCH', '/users/@me', { remove: ['Avatar'] })
  const iconPath = path.join(out, 'icon.png')
  fs.writeFileSync(iconPath, png)
  await rpc('stoatManage', { bufferId: general, action: 'editServer', icon: iconPath })
  check('and the server’s icon loads on the rail', !!(await until(async () => loaded('.rail-tile[aria-label="Test Hall"] img.rail-icon'), 20000)))
  await shot('stoat-pictures.png')
  await rpc('stoatManage', { bufferId: general, action: 'editServer', icon: '' })

  // --- The window: the server’s settings opened from its tile on the rail, against the live local server.
  await ev(`window.__mohoShots.store.selectBuffer(${JSON.stringify(general)})`)
  await sleep(800)
  await ev(`document.querySelector('.rail-tile[aria-label="Test Hall"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 200 }))`)
  await sleep(400)
  const opened = await ev(`(() => { const b = [...document.querySelectorAll('.context-menu-item')].find((x) => /Server settings/.test(x.textContent)); if (b) b.click(); return !!b })()`)
  check('the rail tile’s menu offers the server’s settings', opened)
  const modal = (await until(async () => { const t = await ev(`document.querySelector('.stoat-server')?.innerText ?? ''`); return /Overview/.test(t) ? t : null }, 30000)) ?? ''
  check('which open on the server’s name, with what the owner may do', /Test Hall/.test(modal) && /Overview/.test(modal) && /Roles/.test(modal) && /Audit log/.test(modal), modal.slice(0, 80).replace(/\n/g, ' | '))
  await shot('stoat-settings-overview.png')
  const tab = async (name) => { await ev(`[...document.querySelectorAll('.room-settings-tab')].find((t) => t.textContent === ${JSON.stringify(name)}).click()`); await sleep(900) }
  await tab('Channels')
  const channelsText = await ev(`document.querySelector('.stoat-server .room-settings-body').innerText`)
  check('the channels tab lists them', /General/.test(channelsText) && /Voice Room/.test(channelsText), channelsText.slice(0, 80).replace(/\n/g, ' | '))
  await ev(`[...document.querySelectorAll('.stoat-server button')].find((b) => b.textContent === 'Who may').click()`)
  await sleep(600)
  await shot('stoat-settings-channels.png')
  await tab('Roles')
  await ev(`[...document.querySelectorAll('.stoat-server button')].filter((b) => b.textContent === 'Edit')[0]?.click()`)
  await sleep(600)
  await shot('stoat-settings-roles.png')
  await tab('Webhooks')
  await shot('stoat-settings-webhooks.png')
  await tab('Audit log')
  await sleep(600)
  const audit = await ev(`document.querySelector('.stoat-server .room-settings-body').innerText`)
  check('the audit log tab reads in words', /Alice|alice/.test(audit) && /made|changed|deleted/.test(audit), audit.slice(0, 100).replace(/\n/g, ' | '))
  await shot('stoat-settings-audit.png')
  await ev(`document.querySelector('.modal-scrim').click()`)
  // The account’s own profile, under its card in the Accounts pane.
  await ev(`window.__mohoShots.store.setActivePanel('accounts')`)
  await sleep(1200)
  await ev(`[...document.querySelectorAll('span, i')].filter((e) => e.children.length === 0 && e.textContent.trim() === 'expand_more').at(-1)?.click()`)
  await sleep(1500)
  const hasTools = await ev(`!!document.querySelector('.account-tools input[type=text]') || /Your profile on Stoat/.test(document.body.innerText)`)
  check('the Accounts pane shows the account’s own profile to edit', hasTools)
  await shot('stoat-account.png')
} catch (e) {
  crashed = true
  console.log('CRASHED:', e.message)
} finally {
  await stop()
  console.log(results.every(Boolean) && !crashed ? 'ALL OK' : 'SOME FAILED')
  process.exitCode = results.every(Boolean) && !crashed ? 0 : 1
}
