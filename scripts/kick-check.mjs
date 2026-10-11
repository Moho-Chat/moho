#!/usr/bin/env node
/**
 * Checks where a Kick event card sits in the log, in each layout.
 *
 * A card is what a person did, so it takes the column a person's picture would
 * (and not the mark a join gets), what is written in it starts where a name
 * does, and it has the air above it that a message and an embed have. These
 * are measured against a real chat line beside it rather than against numbers,
 * so they hold when the layout's own numbers change.
 *
 *   npm run test:kick        (builds first; needs the daemon built too)
 */
import { fakeIrc, launchApp, openIrcChannel, sleep, until, click } from './lib/harness.mjs'

let failures = 0
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : detail ? ` - ${detail}` : ''}`)
  if (!ok) failures++
}
setTimeout(() => {
  console.log('FAIL timed out')
  process.exit(1)
}, 120000).unref()

const irc = await fakeIrc({ people: ['bob'], onJoin: (channel, _nick, send) => send(`:bob!b@h PRIVMSG ${channel} :hello there`) })
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })

const stage = `(() => {
  const shots = window.__mohoShots
  const s = shots.state()
  const id = s.activeBufferId
  const now = Math.floor(Date.now() / 1000)
  const row = (n, kind, body, embed, from) => ({ id: 'k' + n, bufferId: id, from, senderId: from, body, ts: now - 600 + n * 70, isAction: false, isHighlight: false, kind, isOwn: false, embeds: embed ? [embed] : [] })
  shots.patch({ messagesByBuffer: { ...s.messagesByBuffer, [id]: [
    row(1, 'chat', 'that was a clean run', null, 'bob'),
    row(2, 'chat', 'and then it got worse', null, 'carol'),
    row(3, 'kicks', 'Currington sent 1 Kick', { kind: 'kicks', author: 'Currington', title: '1', color: 0x53fc18 }, 'kicker'),
    row(4, 'sub', 'ItsDez gifted 2 subscriptions', { kind: 'gift-sub', author: 'ItsDez', title: '2', description: 'a\\nb' }, 'kicker'),
    row(5, 'reward', 'poo_nana redeemed MUTE', { kind: 'redeem', author: 'poo_nana', title: 'MUTE (user) 30 MINUTES', description: 'O_C_T_O', color: 0xff4b1f }, 'kicker'),
    row(6, 'raid', 'x raided with 25 viewers', { kind: 'raid', author: 'kreationX', title: '25' }, 'kicker'),
    row(8, 'sub', 'bigkhernandez subscribed - 21 months', { kind: 'subscribe', author: 'bigkhernandez', title: '21' }, 'kicker'),
    row(9, 'moderation', 'troll was timed out by mod', { kind: 'moderation', author: 'troll', title: 'was timed out', description: 'mod' }, 'kicker'),
    row(10, 'stream', 'went live', { kind: 'stream', author: 'streamer', title: 'went live', icon: 'live' }, 'kicker'),
    row(11, 'chat', 'thanks everybody', null, 'dave')
  ] } })
})()`

const measure = `(() => {
  const x = (el) => (el ? Math.round(el.getBoundingClientRect().left) : null)
  const rows = [...document.querySelectorAll('.message-row')]
  const chat = rows.find((r) => !r.classList.contains('has-kick-event') && r.querySelector('.message-from'))
  const cards = rows.filter((r) => r.classList.contains('has-kick-event'))
  const margin = (r) => parseFloat(getComputedStyle(r).marginTop)
  return {
    marks: cards.filter((r) => r.querySelector('.system-mark')).length,
    cards: cards.length,
    chatEdge: x(chat.querySelector('.message-avatar img, .message-avatar .avatar-fallback') || chat.querySelector('.message-content')),
    chatName: x(chat.querySelector('.message-from')),
    cardEdge: cards.map((r) => x(r.querySelector('.kick-event'))),
    cardName: cards.map((r) => x(r.querySelector('.kick-event-name'))),
    gapAbove: cards.map(margin),
    chatGap: margin(chat) || 0,
    wide: cards.map((r) => Math.round(r.querySelector('.kick-event').getBoundingClientRect().width))
  }
})()`

try {
  await until(page, 'window.__mohoShots', 'the harness hook')
  await openIrcChannel(page, { port: irc.address().port, nick: 'checker', channels: ['#lobby'], waitFor: 'hello there' })
  for (const mode of ['comfy', 'bubbles', 'classic']) {
    await page.evaluate(`window.moho.prefs.set('display.messageMode', ${JSON.stringify(mode)})`)
    await page.call('Page.reload')
    await until(page, 'window.__mohoShots && document.querySelector("nav[aria-label=Servers] [aria-label]")', 'the window after a reload')
    await sleep(500)
    await page.evaluate(click('nav[aria-label=Servers] [aria-label*="localhost"]'))
    await sleep(300)
    await page.evaluate(click('.buffer-row', '#lobby'))
    await sleep(500)
    await page.evaluate(stage)
    await sleep(700)
    const m = await page.evaluate(measure)
    console.log(`${mode}: ${JSON.stringify(m)}`)
    check(m.cards === 7, `${mode}: every kind of card is drawn`, `${m.cards}`)
    check(m.marks === 0, `${mode}: no join mark beside a card`, `${m.marks}`)
    if (mode !== 'classic') {
      // The card starts at the picture's edge.
      check(m.cardEdge.every((e) => Math.abs(e - m.chatEdge) <= 2), `${mode}: a card starts where a person's picture does`, `${m.cardEdge} vs ${m.chatEdge}`)
      // And what is written in it starts where a name does.
      check(m.cardName.every((n) => Math.abs(n - m.chatName) <= 2), `${mode}: the name in a card is where a name is in the log`, `${m.cardName} vs ${m.chatName}`)
    }
    check(m.gapAbove.every((g) => g >= (mode === 'comfy' ? m.chatGap : 4) - 0.5), `${mode}: a card has air above it`, `${m.gapAbove} vs ${m.chatGap}`)
    check(m.wide.every((w) => w > 200), `${mode}: and is not squeezed or centred away`, `${m.wide}`)
  }
} finally {
  await stop()
  irc.close()
}
console.log(failures ? `${failures} FAILED` : 'all passed')
process.exit(failures ? 1 : 0)
