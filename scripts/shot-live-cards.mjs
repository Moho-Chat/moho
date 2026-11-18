#!/usr/bin/env node
/**
 * Photographs polls and predictions (#339) in each stage, with made-up cards over a fake IRC channel in a scratch
 * home: a prediction and a poll at once, as a channel can have both.
 *
 *   node scripts/shot-live-cards.mjs <output directory>
 */
import fs from 'node:fs'
import path from 'node:path'
import { fakeIrc, launchApp, openIrcChannel, sleep } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const irc = await fakeIrc({ people: ['alice'], onJoin: (c, _n, send) => send(`:alice!u@h PRIVMSG ${c} :hello there`) })
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const shot = async (name) => {
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
  console.log('wrote', name)
}
const base = { duration: 0, remaining: 0, resultDisplayDuration: 0, hasVoted: false, votedOptionId: null }
const two = [
  { id: 'y', label: 'Yes', votes: 48200, odds: '1:1.6', backers: 312 },
  { id: 'n', label: 'No', votes: 28300, odds: '1:2.7', backers: 201 }
]
const acts = [
  { id: 'a1', label: 'Act 1', votes: 33900, odds: '1:2.3', backers: 280 },
  { id: 'a2', label: 'Act 2', votes: 23900, odds: '1:3.2', backers: 190 },
  { id: 'a3', label: 'Act 3', votes: 13100, odds: '1:5.9', backers: 110 },
  { id: 'a4', label: 'Beats the game', votes: 6200, odds: '1:12', backers: 60 }
]
const food = [
  { id: 1, label: 'Pizza', votes: 28 },
  { id: 2, label: 'Thai', votes: 52 },
  { id: 3, label: 'Tacos', votes: 32 },
  { id: 4, label: 'Soup', votes: 16 }
]
const scenes = {
  'cards-open': {
    prediction: { ...base, kind: 'prediction', id: 'p1', title: 'Does he beat the boss this run?', options: two, duration: 120, remaining: 58, state: 'ACTIVE', total: 76500, balance: 12840, minBet: 10 },
    poll: { ...base, kind: 'poll', id: 'q1', title: 'Pizza tonight?', options: [{ id: 1, label: 'Yes', votes: 37 }, { id: 2, label: 'No', votes: 27 }], duration: 60, remaining: 42 }
  },
  'cards-voted': {
    prediction: { ...base, kind: 'prediction', id: 'p2', title: 'Which act does he finish on?', options: acts, duration: 180, remaining: 72, state: 'ACTIVE', total: 77100, balance: 11840, minBet: 10, hasVoted: true, votedOptionId: 'a2', stake: 1000, yourReturn: 3200 },
    poll: { ...base, kind: 'poll', id: 'q2', title: 'Where are we eating Friday?', options: food, open: true, hasVoted: true, votedOptionId: 2, changeable: true }
  },
  'cards-locked': {
    prediction: { ...base, kind: 'prediction', id: 'p3', title: 'Does he beat the boss this run?', options: two, state: 'LOCKED', total: 76500, hasVoted: true, votedOptionId: 'y', stake: 6420, yourReturn: 10270 },
    poll: { ...base, kind: 'poll', id: 'q3', title: 'Which nights work?', options: [{ id: 'f', label: 'Friday', votes: 9 }, { id: 's', label: 'Saturday', votes: 5 }, { id: 'u', label: 'Sunday', votes: 11 }], open: true, multiple: true, hasVoted: true, votedOptionIds: ['f', 'u'], votedOptionId: null }
  },
  'cards-decided': {
    prediction: { ...base, kind: 'prediction', id: 'p4', title: 'Does he beat the boss this run?', options: [{ ...two[0], winner: true }, { ...two[1], winner: false }], state: 'RESOLVED', total: 76500, hasVoted: true, votedOptionId: 'y', stake: 6420, yourReturn: 10270 },
    poll: { ...base, kind: 'poll', id: 'q4', title: 'Where are we eating Friday?', options: [{ id: 1, label: 'Pizza', votes: 26 }, { id: 2, label: 'Thai', votes: 39 }, { id: 3, label: 'Tacos', votes: 51 }, { id: 4, label: 'Soup', votes: 15 }], open: false, closed: true, hasVoted: true, votedOptionId: 2 }
  },
  'cards-lost': {
    prediction: { ...base, kind: 'prediction', id: 'p5', title: 'Which act does he finish on?', options: acts.map((a) => ({ ...a, winner: a.id === 'a3' })), state: 'RESOLVED', total: 77100, hasVoted: true, votedOptionId: 'a2', stake: 1000 },
    poll: { ...base, kind: 'poll', id: 'q5', title: 'Pizza tonight?', options: [{ id: 1, label: 'Yes', votes: 42 }, { id: 2, label: 'No', votes: 29 }], open: false, closed: true, hasVoted: true, votedOptionId: 1 }
  }
}
try {
  await openIrcChannel(page, { port: irc.address().port, nick: 'checker', channels: ['#ui'], waitFor: 'hello there' })
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  for (const [name, cards] of Object.entries(scenes)) {
    await page.evaluate(`(() => {
      const s = window.__mohoShots
      const b = s.state().buffers.find((x) => x.id.endsWith('|#ui')).id
      const now = Date.now()
      const cards = ${JSON.stringify(cards)}
      s.patch({ livePolls: { [b + '|prediction']: { ...cards.prediction, bufferId: b, receivedAt: now }, [b + '|poll']: { ...cards.poll, bufferId: b, receivedAt: now } } })
    })()`)
    await sleep(600)
    if (name === 'cards-open') {
      // Pick a side and press ½, as somebody about to bet would.
      await page.evaluate(`(() => { document.querySelector('.poll-card.prediction .lc-side')?.click() })()`)
      await sleep(150)
      await page.evaluate(`(() => { [...document.querySelectorAll('.poll-card.prediction .lc-chip')].find((c) => c.textContent === '½')?.click() })()`)
      await sleep(300)
    }
    await shot(`${name}.png`)
  }
} finally {
  await stop()
  irc.close()
}
