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
  await openIrcChannel(page, { port: irc.address().port, nick: 'checker', channels: ['#lobby'], waitFor: 'hello there' })

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
  await until(page, `!!document.querySelector('.new-divider')`, 'the New line')
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
} finally {
  await stop()
  irc.close()
}
console.log(failures ? `${failures} FAILED` : 'all passed')
process.exit(failures ? 1 : 0)
