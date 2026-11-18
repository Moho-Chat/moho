#!/usr/bin/env node
/**
 * Signal, as the daemon does it, against a real linked account: messages, a reply, a picture, a reaction, an edit, a
 * delete, a timer, a poll, a view-once picture, and, when the account has a group, a group message and a group story.
 * Everything goes to Note to Self (and the group), so nobody else is written to.
 *
 * Signal accounts cannot be made for a test, so this does not start a daemon of its own: it talks to one already running
 * with a linked account in a scratch home - the second moho (~/.local/share/moho-dev/moho2.sh start). It refuses the
 * live daemon's socket, so the account the person uses is never the one driven.
 *
 *   ~/.local/share/moho-dev/moho2.sh start
 *   SIGNAL_PROBE_RUNTIME=/tmp/claude-1000/m2run node scripts/probe-signal.mjs [--group "Group name"]
 *
 * Each step says ok or what went wrong; the exit code is the number that went wrong.
 */
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { sleep } from './lib/harness.mjs'

const runtime = process.env.SIGNAL_PROBE_RUNTIME
if (!runtime) {
  console.error('SIGNAL_PROBE_RUNTIME must name the runtime folder of a test daemon (one holding nobilis/nobilis.sock)')
  process.exit(2)
}
const live = process.env.XDG_RUNTIME_DIR ?? `/run/user/${os.userInfo().uid}`
if (path.resolve(runtime) === path.resolve(live)) {
  console.error('That is the live daemon. Start the second moho and point SIGNAL_PROBE_RUNTIME at its runtime folder')
  process.exit(2)
}
const groupArg = process.argv.indexOf('--group')
const groupName = groupArg > 0 ? process.argv[groupArg + 1] : null

const sock = path.join(runtime, 'nobilis', 'nobilis.sock')
const conn = net.connect(sock)
let buf = ''
let nextId = 1
const waiting = new Map()
conn.on('data', (d) => {
  buf += d
  const lines = buf.split('\n')
  buf = lines.pop()
  for (const line of lines) {
    if (!line.trim()) continue
    const m = JSON.parse(line)
    if (m.id && waiting.has(m.id)) {
      const { resolve, reject } = waiting.get(m.id)
      waiting.delete(m.id)
      if (m.error) reject(new Error(typeof m.error === 'string' ? m.error : JSON.stringify(m.error)))
      else resolve(m.result)
    }
  }
})
await new Promise((resolve, reject) => {
  conn.once('connect', resolve)
  conn.once('error', reject)
})
const rpc = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    waiting.set(id, { resolve, reject })
    conn.write(JSON.stringify({ id, method, params }) + '\n')
  })

const backlog = async (bufferId) => {
  const rows = await rpc('getBacklog', { bufferId, limit: 50 })
  return (Array.isArray(rows) ? rows : rows.messages ?? []).slice().sort((a, b) => a.ts - b.ts)
}
/** Waits until `test` finds a row in the conversation, and answers it. */
const waitFor = async (bufferId, what, test, ms = 30000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const found = (await backlog(bufferId)).filter(test).pop()
    if (found) return found
    await sleep(500)
  }
  throw new Error(`no ${what} after ${ms / 1000} seconds`)
}

let failures = 0
const step = async (name, run) => {
  try {
    const said = await run()
    console.log(`ok    ${name}${said ? `: ${said}` : ''}`)
  } catch (e) {
    failures++
    console.log(`FAIL  ${name}: ${e.message}`)
  }
}

const buffers = await rpc('listBuffers', {})
const signal = buffers.filter((b) => (b.accountId ?? '').startsWith('signal:'))
const nts = signal.find((b) => b.name === 'Note to Self')
if (!nts) {
  console.error('No Note to Self on the test daemon: is a Signal account linked there?')
  process.exit(2)
}
const group = signal.find((b) => (b.remoteId ?? '').startsWith('g:') && (!groupName || b.name === groupName))
const tag = `probe ${new Date().toISOString().slice(11, 19)}`
const mine = (body) => (m) => m.isOwn && m.body === body

const picture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'moho-signal-probe-')), 'probe.png')
// A small picture of its own, so the probe needs nothing on disk: ImageMagick when there is one, else a 1x1 PNG.
try {
  execFileSync('magick', ['-size', '64x48', 'gradient:teal-orange', picture])
} catch {
  fs.writeFileSync(picture, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
}

let first
await step('text to Note to Self', async () => {
  await rpc('sendMessage', { bufferId: nts.id, body: `${tag} *bold* and _italic_` })
  first = await waitFor(nts.id, 'own message', mine(`${tag} bold and italic`))
  return first.html ? 'styled' : 'no styles drawn'
})

await step('a reply', async () => {
  await rpc('sendMessage', { bufferId: nts.id, body: `${tag} reply`, replyToId: first.id })
  const row = await waitFor(nts.id, 'reply', mine(`${tag} reply`))
  if (row.replyTo?.id !== first.id) throw new Error('the reply does not name the message it answers')
})

await step('a picture', async () => {
  await rpc('sendMessage', { bufferId: nts.id, body: `${tag} picture`, attachmentPath: picture })
  const row = await waitFor(nts.id, 'picture', mine(`${tag} picture`), 120000)
  if (!row.attachments?.length) throw new Error('no attachment on the message')
  return row.attachments[0].mimetype
})

await step('a reaction, and taking it back', async () => {
  await rpc('toggleReaction', { bufferId: nts.id, messageId: first.id, emoji: '👍', add: true })
  await waitFor(nts.id, 'reaction', (m) => m.id === first.id && (m.reactions ?? []).some((r) => r.emoji === '👍'))
  await rpc('toggleReaction', { bufferId: nts.id, messageId: first.id, emoji: '👍', add: false })
  await waitFor(nts.id, 'reaction gone', (m) => m.id === first.id && !(m.reactions ?? []).some((r) => r.emoji === '👍'))
})

await step('an edit', async () => {
  await rpc('editMessage', { bufferId: nts.id, messageId: first.id, body: `${tag} edited` })
  await waitFor(nts.id, 'edited message', (m) => m.id === first.id && m.body === `${tag} edited` && m.edited)
})

await step('a delete for everyone', async () => {
  await rpc('sendMessage', { bufferId: nts.id, body: `${tag} to delete` })
  const row = await waitFor(nts.id, 'message to delete', mine(`${tag} to delete`))
  await rpc('deleteMessage', { bufferId: nts.id, messageId: row.id })
  const end = Date.now() + 30000
  while (Date.now() < end && (await backlog(nts.id)).some((m) => m.id === row.id)) await sleep(500)
  if ((await backlog(nts.id)).some((m) => m.id === row.id)) throw new Error('still there')
})

await step('a disappearing timer, set and cleared', async () => {
  await rpc('signalSetTimer', { bufferId: nts.id, seconds: 300 })
  await waitFor(nts.id, 'timer line', (m) => /disappearing messages to 5 minutes/i.test(m.body))
  await rpc('signalSetTimer', { bufferId: nts.id, seconds: 0 })
  await waitFor(nts.id, 'timer off line', (m) => /turned off disappearing messages/i.test(m.body))
})

await step('a poll, ended', async () => {
  await rpc('startMatrixPoll', { bufferId: nts.id, question: `${tag} poll?`, answers: ['yes', 'no'], multiple: false })
  await waitFor(nts.id, 'poll line', (m) => m.body === `[Poll: ${tag} poll?]`)
  const polls = await rpc('listPolls', { bufferId: nts.id, limit: 5 })
  const poll = (Array.isArray(polls) ? polls : polls.polls ?? []).find((p) => JSON.stringify(p).includes(`${tag} poll?`))
  if (!poll) throw new Error('the poll card was not kept')
  await rpc('endPoll', { bufferId: nts.id, pollId: poll.id ?? poll.pollId })
})

await step('a view-once picture', async () => {
  await rpc('sendMessage', { bufferId: nts.id, body: '', attachmentPath: picture, spoilerPaths: [picture] })
  await waitFor(nts.id, 'view-once line', (m) => m.isOwn && m.body === '[View-once media]', 120000)
})

if (group) {
  await step(`a message to ${group.name}`, async () => {
    await rpc('sendMessage', { bufferId: group.id, body: `${tag} group` })
    await waitFor(group.id, 'group message', mine(`${tag} group`))
  })
  await step(`a story to ${group.name}`, async () => {
    await rpc('postSignalStory', { bufferId: group.id, text: `${tag} story`, allowReplies: true })
    const stories = signal.find((b) => b.remoteId === 'stories') ?? (await rpc('listBuffers', {})).find((b) => b.accountId === nts.accountId && b.remoteId === 'stories')
    if (!stories) throw new Error('no Stories conversation')
    await waitFor(stories.id, 'story', (m) => m.isOwn && m.body.endsWith(`${tag} story`))
  })
} else {
  console.log('skip  group message and story: the account is in no group')
}

conn.end()
fs.rmSync(path.dirname(picture), { recursive: true, force: true })
console.log(failures ? `${failures} step(s) went wrong` : 'all steps ok')
process.exit(failures)
