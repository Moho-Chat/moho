#!/usr/bin/env node
/**
 * A room's picture (XEP-0486): the hash the room's disco#info gives and the picture its vCard holds. Set by another client that
 * owns the room, it reaches this one (the room's status 104, then disco#info and the vCard); set by moho in a room moho owns, the
 * other client reads it back the same way; a member who is not an owner is refused in words.
 *
 *   node scripts/probe-xmpp-room-avatar.mjs        (ejabberd)        XMPP_TEST_SERVER=prosody node scripts/probe-xmpp-room-avatar.mjs
 */
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { start, sleep, CONF } from './lib/xmpp-daemon.mjs'

// A room's picture is small (64 px, as clients make them); a large one is slowed to a crawl by the test server's rate limit.
const picture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'moho-roompic-')), 'room.png')
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', path.join(os.homedir(), '.local/share/moho-dev/avatar.png'), '-vf', 'scale=64:64', picture])
const bytes = fs.readFileSync(picture)
const sha1 = crypto.createHash('sha1').update(bytes).digest('hex')
const t = await start({ people: 2 })
const [me, you] = t.accounts
const myId = t.accountId(me)
const theirs = `pics${t.stamp}@${CONF}`
const mine = `mypics${t.stamp}@${CONF}`
const avatarOf = async (bufferId) => (await t.rpc('listBuffers')).find((b) => b.id === bufferId)?.avatarUrl ?? ''
try {
  t.check('it signs in', !!(await t.signIn(me)))

  console.log("a room another client owns")
  // The other client makes the room (an instant room) and stays in it for the rest.
  const joinTheirs = [
    { raw: `<presence xmlns='jabber:client' to='${theirs}/owner'><x xmlns='http://jabber.org/protocol/muc'/></presence>` },
    { sleep: 1 },
    { raw: `<iq xmlns='jabber:client' type='set' id='cfg' to='${theirs}'><query xmlns='http://jabber.org/protocol/muc#owner'><x xmlns='jabber:x:data' type='submit'/></query></iq>` },
    { sleep: 1 }
  ]
  const setPhoto = { raw: `<iq xmlns='jabber:client' type='set' id='av' to='${theirs}'><vCard xmlns='vcard-temp'><PHOTO><TYPE>image/png</TYPE><BINVAL>${bytes.toString('base64')}</BINVAL></PHOTO></vCard></iq>` }
  const peer = t.peer(you, [...joinTheirs, { sleep: 4 }, setPhoto, { wait_for: "id='av'", timeout: 8 }, { sleep: 6 }])
  await sleep(2500)
  const r = await t.rpc('xmppJoinRoom', { accountId: myId, jid: theirs, nick: 'mohonick', bookmark: false })
  const set = await peer
  const answered = set.received.slice(set.received.indexOf("id='av'") - 300, set.received.indexOf("id='av'") + 200)
  t.check('the owner sets a picture', /type=['"]result['"]/.test(answered), answered)
  const shown = await t.until(async () => /^file:\/\//.test(await avatarOf(r.bufferId)), 10000)
  t.check('and it reaches this client as the room\'s picture', !!shown, await avatarOf(r.bufferId))
  const err = await t.rpc('xmppSetRoomAvatar', { bufferId: r.bufferId, path: picture }).then(() => '', (e) => e.message)
  t.check('a member who is not an owner cannot set it, and is told', /owner|forbidden|not allow|permission/i.test(err), err)

  console.log('a room moho owns')
  const m = await t.rpc('xmppJoinRoom', { accountId: myId, jid: mine, nick: 'mohonick', bookmark: false })
  await sleep(1500)
  await t.rpc('xmppSetRoomAvatar', { bufferId: m.bufferId, path: picture })
  t.check('moho sets its picture, and shows it', !!(await t.until(async () => /^file:\/\//.test(await avatarOf(m.bufferId)), 8000)), await avatarOf(m.bufferId))
  const read = await t.peer(you, [
    { raw: `<iq xmlns='jabber:client' type='get' id='di' to='${mine}'><query xmlns='http://jabber.org/protocol/disco#info'/></iq>` },
    { raw: `<iq xmlns='jabber:client' type='get' id='vc' to='${mine}'><vCard xmlns='vcard-temp'/></iq>` },
    { wait_for: "id='vc'", timeout: 8 },
    { sleep: 0.5 }
  ])
  t.check('the other client finds its hash in disco#info', read.received.includes(sha1), sha1)
  t.check('and the picture in its vCard', read.received.includes(bytes.toString('base64').slice(0, 60)))
} catch (err) {
  t.failed(err)
} finally {
  await t.finish()
}
