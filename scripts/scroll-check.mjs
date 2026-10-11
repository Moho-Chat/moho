#!/usr/bin/env node
/**
 * Checks that a reader scrolling through a long unread run is not put back.
 *
 * The "N new messages since" bar sits over the top of the log. What the list
 * remembers about where the reader is came from asking the page what is at its
 * top edge - which, while the bar is up, is the bar. So the place stopped being
 * kept up to date the moment the bar appeared, and the next thing to change
 * size (a card arriving, a picture loading) put the view back where the
 * reader had been when it appeared.
 *
 *   npm run test:scroll        (builds first; needs the daemon built too)
 */
import { fakeIrc, launchApp, openIrcChannel, sleep, until } from './lib/harness.mjs'

let failures = 0
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : detail ? ` - ${detail}` : ''}`)
  if (!ok) failures++
}
setTimeout(() => {
  console.log('FAIL timed out')
  process.exit(1)
}, 90000).unref()

const irc = await fakeIrc({
  people: ['bob'],
  onJoin: (channel, _nick, send) => send(`:bob!b@h PRIVMSG ${channel} :hello there`)
})
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
try {
  await until(page, 'window.__mohoShots', 'the harness hook')
  await openIrcChannel(page, { port: irc.address().port, nick: 'checker', channels: ['#lobby', '#other'], waitFor: 'hello there' })

  // Three hundred messages, the last two hundred of them unread.
  await page.evaluate(`(() => {
    const shots = window.__mohoShots
    const s = shots.state()
    const id = s.activeBufferId
    const now = Math.floor(Date.now() / 1000)
    const list = Array.from({ length: 300 }, (_, n) => ({
      id: 'm' + n, bufferId: id, from: n % 3 ? 'bob' : 'carol', senderId: n % 3 ? 'bob' : 'carol',
      body: 'message number ' + n + ' with a little text in it', ts: now - 40000 + n * 60,
      isAction: false, isHighlight: false, kind: 'chat', isOwn: false
    }))
    shots.patch({
      messagesByBuffer: { ...s.messagesByBuffer, [id]: list },
      dividerTsByBuffer: { ...s.dividerTsByBuffer, [id]: list[99].ts }
    })
  })()`)
  // Two hundred unread is more than a screenful: opened at its end, as
  // Discord does, with the bar saying how much is above and not the log
  // dropped hundreds of messages up.
  await until(page, `!!document.querySelector('.unread-bar')`, 'the unread bar')
  await sleep(600)
  const opened = await page.evaluate(`(() => {
    const el = document.querySelector('.messagelist-scroll')
    return { fromBottom: el.scrollHeight - el.scrollTop - el.clientHeight, line: !!document.querySelector('.new-divider'), bar: document.querySelector('.unread-bar-text')?.textContent }
  })()`)
  check(opened.fromBottom < 8 && !opened.line, 'a long unread run opens at the end of the conversation', JSON.stringify(opened))
  check(/^200 new messages/.test(opened.bar ?? ''), 'and the bar says how much there is', opened.bar)
  await page.evaluate(`document.querySelector('.unread-bar-text').click()`)
  await until(page, `!!document.querySelector('.new-divider')`, 'the New line after pressing the bar')
  await sleep(600)

  // Reading down past the line, the way a wheel does: the bar comes up.
  await page.evaluate(`(async () => {
    const el = document.querySelector('.messagelist-scroll')
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true }))
    for (let i = 0; i < 8; i++) {
      el.scrollTop += 120
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }))
      await new Promise((r) => setTimeout(r, 60))
    }
  })()`)
  await until(page, `!!document.querySelector('.unread-bar')`, 'the unread bar')

  // Further down, with the bar over the top of the log the whole way.
  await page.evaluate(`(async () => {
    const el = document.querySelector('.messagelist-scroll')
    for (let i = 0; i < 12; i++) {
      el.scrollTop += 150
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: 150, bubbles: true }))
      await new Promise((r) => setTimeout(r, 60))
    }
  })()`)
  await sleep(300)
  const before = await page.evaluate(`document.querySelector('.messagelist-scroll').scrollTop`)

  // Something above the reader settles taller - a card arriving, a picture
  // loading. The row under the reader's eye is what must stay put.
  const moved = await page.evaluate(`(async () => {
    const el = document.querySelector('.messagelist-scroll')
    const box = el.getBoundingClientRect()
    const rows = [...el.querySelectorAll('[data-msg-id]')]
    const watched = rows.find((r) => r.getBoundingClientRect().top > box.top + 60)
    const was = watched.getBoundingClientRect().top - box.top
    const above = rows.find((r) => r.getBoundingClientRect().bottom < box.top - 50)
    above.style.minHeight = (above.getBoundingClientRect().height + 240) + 'px'
    await new Promise((r) => setTimeout(r, 400))
    return { id: watched.dataset.msgId, drift: watched.getBoundingClientRect().top - box.top - was }
  })()`)
  check(Math.abs(moved.drift) < 2, 'a row above growing leaves the row being read where it was', `moved ${moved.drift}px`)

  // And the position itself did not fall back towards where the bar appeared.
  const after = await page.evaluate(`document.querySelector('.messagelist-scroll').scrollTop`)
  check(after >= before - 4, 'the view did not go back up the log', `${before} -> ${after}`)

  // Leaving, and coming back after more has been said. The line was kept from
  // the first visit, so the return went up the log to a place nothing was
  // unread any more.
  const ids = await page.evaluate(`(() => {
    const s = window.__mohoShots.state()
    return { lobby: s.activeBufferId, other: s.buffers.find((b) => b.name.endsWith('#other')).id }
  })()`)
  const said = (count) => `(() => {
    const shots = window.__mohoShots
    const s = shots.state()
    const id = ${JSON.stringify(ids.lobby)}
    const base = Math.max(...s.messagesByBuffer[id].map((m) => m.ts)) + 1
    const more = Array.from({ length: ${count} }, (_, n) => ({
      id: 'later' + Date.now() + '-' + n, bufferId: id, from: 'bob', senderId: 'bob', body: 'said while away ' + n, ts: base + n,
      isAction: false, isHighlight: false, kind: 'chat', isOwn: false
    }))
    shots.patch({
      messagesByBuffer: { ...s.messagesByBuffer, [id]: [...s.messagesByBuffer[id], ...more] },
      buffers: s.buffers.map((b) => (b.id === id ? { ...b, unread: ${count} } : b))
    })
  })()`
  const away = async (count) => {
    await page.evaluate(`window.__mohoShots.store.selectBuffer(${JSON.stringify(ids.other)}, false)`)
    await sleep(500)
    await page.evaluate(said(count))
    await page.evaluate(`window.__mohoShots.store.selectBuffer(${JSON.stringify(ids.lobby)}, false)`)
    await sleep(1200)
    return page.evaluate(`(() => {
      const el = document.querySelector('.messagelist-scroll')
      const line = document.querySelector('.new-divider')
      const rows = [...el.querySelectorAll('[data-msg-id]')]
      const after = line ? rows.filter((r) => line.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING).length : -1
      return { fromBottom: el.scrollHeight - el.scrollTop - el.clientHeight, line: !!line, after, bar: document.querySelector('.unread-bar-text')?.textContent ?? '' }
    })()`)
  }

  // A few unread: opens at the first of them, and the line is this visit's -
  // thirty rows under it, not the two hundred of the visit before.
  const few = await away(30)
  check(few.line && few.after === 30, 'a short unread run opens at its first message, with the line where this visit began', JSON.stringify(few))

  // A great many: opens at the end, with the bar to go back by.
  const many = await away(100)
  check(many.fromBottom < 8, 'a long one opens at the end and not hundreds of messages up', JSON.stringify(many))
  check(/^100 new messages/.test(many.bar), 'with the bar to go back by', many.bar)

  // Nothing unread: the end.
  await page.evaluate(`window.__mohoShots.store.selectBuffer(${JSON.stringify(ids.other)}, false)`)
  await sleep(500)
  await page.evaluate(`window.__mohoShots.store.selectBuffer(${JSON.stringify(ids.lobby)}, false)`)
  await sleep(1000)
  const nothing = await page.evaluate(`(() => { const el = document.querySelector('.messagelist-scroll'); return { fromBottom: el.scrollHeight - el.scrollTop - el.clientHeight, line: !!document.querySelector('.new-divider') } })()`)
  check(nothing.fromBottom < 8 && !nothing.line, 'a conversation left read and returned to is at its end', JSON.stringify(nothing))
} finally {
  await stop()
  irc.close()
}
console.log(failures ? `${failures} FAILED` : 'all passed')
process.exit(failures ? 1 : 0)
