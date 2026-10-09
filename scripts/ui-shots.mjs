#!/usr/bin/env node
/**
 * Pictures of the app, for comparing a change's before and after.
 *
 * Launches the built app against a throwaway home (see lib/harness.mjs - no
 * real account, no shared daemon), gives it an IRC network to show from a
 * small fake server, and photographs a fixed list of scenes. Discord-shaped
 * screens that no fake server can produce - a guild's channels, a voice
 * call, reactions - are filled in through the test-only state hook main
 * installs when started with MOHO_UI_SHOTS=1.
 *
 *   node scripts/ui-shots.mjs --out before              every scene
 *   node scripts/ui-shots.mjs --out after --only rail   scenes whose name holds "rail"
 *   node scripts/ui-shots.mjs --compare before after    writes compare.html
 *
 * Builds nothing: run `npx electron-vite build` first (and have the daemon
 * built). Pictures go to ~/.local/share/moho-dev/ui-shots/<out>/, or
 * $MOHO_UI_SHOTS_DIR; motion is recorded as short mp4s with ffmpeg.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { at, click, fakeIrc, launchApp, openIrcChannel, sleep, until } from './lib/harness.mjs'

const SIZE = { width: 1280, height: 800 }
const DIR = process.env.MOHO_UI_SHOTS_DIR ?? path.join(os.homedir(), '.local/share/moho-dev/ui-shots')
const NICK = 'salastil'
const PEOPLE = ['alice', 'bob', 'carol', 'dave', 'eve_the_longer_named', 'frank']

// --- what the fake network says ---------------------------------------------

const DAY = 24 * 3600 * 1000
/** Midnight today, local time: history is placed relative to it. */
const today = (() => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
})()
const when = (daysAgo, hh, mm) => new Date(today - daysAgo * DAY + (hh * 60 + mm) * 60000)

const HISTORY = {
  '#general': [
    [3, 9, 12, 'alice', 'morning all - anyone tried the new build?'],
    [3, 9, 13, 'bob', 'yeah, the voice stuff is way better than last week'],
    [3, 9, 15, 'alice', 'nice, I will grab it tonight'],
    [1, 18, 40, 'carol', 'has anyone seen the release notes for 1.0? they look long'],
    [1, 18, 41, 'dave', '\u0001ACTION goes to read them\u0001'],
    [1, 18, 44, 'eve_the_longer_named', 'they are long, but the YouTube cards alone are worth it https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    [0, 10, 2, 'frank', 'today is the day'],
    [0, 10, 3, 'alice', `${NICK}: can you check the channel list on your end? something looks off with the badges`],
    [0, 10, 5, 'bob', 'it is \u0002bold\u0002, it is \u000304red\u0003, it is \u001dslanted\u001d - IRC formatting still renders'],
    [0, 10, 6, 'carol', 'a longer message to see how wrapping looks in the message list when somebody writes a whole paragraph instead of a quick line, which happens more often than you would think in a channel like this one'],
    [0, 10, 7, 'carol', 'and a second one right after, so grouping shows'],
    [0, 10, 9, 'dave', 'lunch?']
  ],
  '#random': [
    [0, 9, 30, 'bob', 'random thought: tabs or spaces'],
    [0, 9, 31, 'frank', 'spaces, obviously'],
    [0, 9, 33, 'eve_the_longer_named', 'tabs, and I will not be taking questions']
  ],
  '#dev': [
    [0, 8, 0, 'alice', 'build is green'],
    [0, 8, 1, 'carol', `${NICK}: review when you get a sec?`]
  ],
  '#announcements': [[2, 12, 0, 'frank', 'Maintenance window on Saturday, 02:00-04:00 UTC']]
}
const CHANNELS = Object.keys(HISTORY)

function onJoin(channel, _nick, send) {
  for (const [daysAgo, hh, mm, who, text] of HISTORY[channel] ?? []) {
    send(`${at(when(daysAgo, hh, mm))}:${who}!u@h PRIVMSG ${channel} :${text}`)
  }
  if (channel === '#general') {
    send(`${at(when(0, 10, 10))}:frank!u@h PART #general :off to lunch`)
    send(`${at(when(0, 10, 11))}:grace!u@h JOIN #general`)
  }
}

// --- Discord-shaped state, for the screens IRC cannot reach ----------------

/**
 * Runs in the page: a Discord account with two guilds, channels in
 * categories, a call in progress and a conversation with reactions and a
 * reply, put straight into the store.
 */
const DISCORD = `(() => {
  const shots = window.__mohoShots
  const s = shots.state()
  const acc = 'discord:shots'
  const g1 = acc + '|guild:1', g2 = acc + '|guild:2'
  const now = Math.floor(Date.now() / 1000)
  const ch = (id, name, category, extra = {}) => ({
    id: acc + '|' + id, accountId: acc, kind: 'channel', name: 'Button Eye Crochet/#' + name,
    lastActivityTs: now, groupId: g1, category, position: Number(id.replace(/\\D/g, '')) || 0,
    unread: 0, highlight: false, ...extra
  })
  const buffers = [
    ch('c1', '📜-rules', undefined),
    ch('c2', '📢-announcements', undefined, { unread: 2 }),
    ch('c3', '🤠-general', 'TEXT CHANNELS'),
    ch('c4', '📹-clips', 'TEXT CHANNELS', { unread: 5 }),
    ch('c5', '📷-screenshots', 'TEXT CHANNELS', { unread: 1, highlight: true }),
    ch('c6', '💩-shitpost', 'TEXT CHANNELS', { unread: 9 }),
    ch('c7', '🎨-crafts', 'TEXT CHANNELS'),
    ch('c8', '🐈-cats', 'ANIMALS', { unread: 3 }),
    ch('c9', '🐕-dogs', 'ANIMALS')
  ]
  const general = acc + '|c3'
  const m = (id, from, body, mins, extra = {}) => ({
    id, bufferId: general, from, body, ts: now - mins * 60, isAction: false, isHighlight: false,
    kind: 'chat', isOwn: false, senderId: from, ...extra
  })
  const messages = [
    m('m1', 'Gaunt King', 'anyone else going to the craft fair this weekend?', 50, { reactions: [{ emoji: '👍', count: 3, me: true }, { emoji: '🧶', count: 1, me: false }] }),
    m('m2', 'Clarence', 'yes! bringing the new amigurumi batch', 48),
    m('m3', 'Clarence', 'pics later', 48),
    m('m4', 'Salastil', 'I can man the table for an hour after lunch', 40, { isOwn: true, edited: true }),
    m('m5', 'Gaunt King', 'perfect - @Salastil you are a lifesaver', 38, { isHighlight: true, replyTo: { id: 'm4', from: 'Salastil', body: 'I can man the table for an hour after lunch' } }),
    m('m6', 'Wren', 'tutorial for the eye stitch, for anyone who asked', 20, {
      embeds: [{ title: 'Safety eyes vs embroidered eyes - which to use', description: 'A short guide to choosing and attaching eyes on crochet toys.', color: 0xff0000, url: 'https://example.com/eyes', provider: 'YouTube', author: 'Hooked Studio' }],
      reactions: [{ emoji: '❤️', count: 4, me: false }]
    }),
    m('m7', 'Clarence', 'that is exactly what I needed, thank you', 18)
  ]
  const members = (who) => who.map(([nick, status]) => ({ nick, userId: nick, status, away: status === 'offline' }))
  shots.patch({
    accounts: [...s.accounts.filter((a) => a.id !== acc), {
      id: acc, service: 'discord', displayName: 'Salastil', state: 'connected', autojoin: '',
      currentNick: 'Salastil', status: 'online', useTor: false, ssl: true
    }],
    groups: [
      ...s.groups.filter((g) => g.accountId !== acc),
      { id: g1, accountId: acc, service: 'discord', kind: 'guild', name: 'Button Eye Crochet', position: 0 },
      { id: g2, accountId: acc, service: 'discord', kind: 'guild', name: 'Moho Dev', position: 1 }
    ],
    buffers: [...s.buffers.filter((b) => b.accountId !== acc), ...buffers,
      { id: acc + '|d1', accountId: acc, kind: 'channel', name: 'Moho Dev/#general', lastActivityTs: now, groupId: g2, unread: 2, highlight: true }],
    messagesByBuffer: { ...s.messagesByBuffer, [general]: messages },
    presenceByBuffer: { ...s.presenceByBuffer, [general]: members([['Gaunt King', 'online'], ['Clarence', 'idle'], ['Wren', 'dnd'], ['Salastil', 'online'], ['Old Friend', 'offline'], ['Quiet One', 'offline']]) },
    activeGroupId: g1,
    activeBufferId: general
  })
  // The window asks the daemon about voice as soon as the guild is on screen,
  // and the daemon knows of no such guild - so this part is put back after
  // that answer has landed (see VOICE).
  window.__shotsVoice = {
    voiceGuildId: '1',
    voiceChannels: [
      { id: 'v1', name: '🦅🪺-the-eagles-nest', userLimit: 0, occupants: 3, empty: false, members: [
        { userId: 'Salastil', nick: 'Salastil', isSelf: true },
        { userId: 'Clarence', nick: 'Clarence', isSelf: false, muted: true },
        { userId: 'Wren', nick: 'Wren', isSelf: false, streaming: true }
      ] },
      { id: 'v2', name: 'quiet room', userLimit: 4, occupants: 0, empty: true, members: [] }
    ],
    voiceSessions: [{ accountId: acc, guildId: '1', channelId: 'v1', channelName: 'the-eagles-nest', isDirect: false }]
  }
  return true
})()`

const VOICE = `window.__mohoShots.patch(window.__shotsVoice), true`
const NO_CALL = `window.__mohoShots.patch({ ...window.__shotsVoice, voiceSessions: [] }), true`

/** The Discord-shaped state, with its voice part put back once the window has asked. */
const discord = (inCall) => async (page) => {
  await page.evaluate(DISCORD)
  await sleep(700)
  await page.evaluate(inCall ? VOICE : NO_CALL)
  await sleep(300)
}

// --- scenes ------------------------------------------------------------------

/** Messages with several pictures, one of them a spoiler (#304): two, three and four, then a lone spoiler. */
const stageGrids = async (page) => {
  await page.evaluate(`(() => {
    const shots = window.__mohoShots
    const s = shots.state()
    const id = s.activeBufferId
    const now = Math.floor(Date.now() / 1000)
    const pic = (a, b, label) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><circle cx="600" cy="400" r="220" fill="none" stroke="#fff" stroke-width="12" stroke-dasharray="36 22"/><text x="600" y="430" font-size="96" font-family="sans-serif" fill="#fff" text-anchor="middle">' + label + '</text></svg>')
    const att = (name, a, b, label) => ({ kind: 'image', filename: name, width: 1200, height: 800, url: pic(a, b, label) })
    const colours = [['#e0a43a', '#b0457a', 'owl'], ['#3a8fe0', '#4a2f9a', 'squares'], ['#3ae0a4', '#1f6f5a', 'blanket'], ['#e05a3a', '#7a2f2f', 'scarf']]
    const msg = (i, from, body, n, spoilerAt) => ({
      id: 'grid' + i, bufferId: id, from, senderId: from, body, ts: now - (8 - i) * 30, isAction: false, isHighlight: false, kind: 'chat', isOwn: false,
      attachments: colours.slice(0, n).map(([a, b, l], k) => att((k === spoilerAt ? 'SPOILER_' : '') + l + '.svg', a, b, l))
    })
    shots.patch({ messagesByBuffer: { ...s.messagesByBuffer, [id]: [...(s.messagesByBuffer[id] || []), msg(1, 'Wren', 'two from the fair', 2, -1), msg(2, 'Clarence', 'three more, the last one is a spoiler', 3, 2), msg(3, 'Wren', 'and four', 4, -1), msg(4, 'Clarence', 'just one, and a spoiler', 1, 0)] } })
    return true
  })()`)
  await sleep(900)
}

/** Three pictures posted in a row, drawn as SVG so nothing is fetched. */
const stageLightbox = async (page) => {
  await page.evaluate(`(() => {
    const shots = window.__mohoShots
    const s = shots.state()
    const id = s.activeBufferId
    const now = Math.floor(Date.now() / 1000)
    const pic = (name, a, b, label) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient></defs><rect width="1600" height="1000" fill="url(#g)"/><circle cx="800" cy="500" r="260" fill="none" stroke="#fff" stroke-width="14" stroke-dasharray="40 24"/><text x="800" y="540" font-size="120" font-family="sans-serif" fill="#fff" text-anchor="middle">' + label + '</text></svg>')
    const msg = (i, label, a, b) => ({
      id: 'pic' + i, bufferId: id, from: 'Wren', senderId: 'Wren', body: '', ts: now - (3 - i) * 20, isAction: false, isHighlight: false, kind: 'chat', isOwn: false,
      attachments: [{ kind: 'image', filename: label.toLowerCase() + '.svg', width: 1600, height: 1000, url: pic(i, a, b, label) }]
    })
    shots.patch({ messagesByBuffer: { ...s.messagesByBuffer, [id]: [...(s.messagesByBuffer[id] || []), msg(1, 'Amigurumi', '#e0a43a', '#b0457a'), msg(2, 'Granny squares', '#3a8fe0', '#4a2f9a'), msg(3, 'Blanket', '#3ae0a4', '#1f6f5a')] } })
    return true
  })()`)
  await sleep(700)
}

const mouse = async (page, type, x, y, button = 'none') =>
  page.call('Input.dispatchMouseEvent', { type, x, y, button, clickCount: button === 'none' ? 0 : 1 })

/** The centre of the first element matching, in window coordinates. */
const centre = (page, selector, text = '') =>
  page.evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.innerText.includes(${JSON.stringify(text)}))
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + Math.min(r.height / 2, 14)) }
  })()`)

/** A key with modifiers held (CDP's bitmask: 1 alt, 2 ctrl, 4 meta, 8 shift). */
const pressKey = async (page, key, code, modifiers = 0) => {
  for (const type of ['keyDown', 'keyUp']) {
    await page.call('Input.dispatchKeyEvent', { type, key, code, modifiers, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) })
  }
}

/** A real left click on the centre of an element, as a person's pointer would make. */
const realClick = async (page, selector) => {
  const at = await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  if (!at) throw new Error(`nothing matches ${selector}`)
  await mouse(page, 'mousePressed', at.x, at.y, 'left')
  await mouse(page, 'mouseReleased', at.x, at.y, 'left')
}

const escape = async (page) => {
  for (const type of ['keyDown', 'keyUp']) {
    await page.call('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  }
  await sleep(150)
}

const openChannel = async (page, name) => {
  await page.evaluate(click('nav[aria-label=Servers] [aria-label*="localhost"]'))
  await sleep(200)
  await page.evaluate(click('.buffer-row', name))
  await sleep(500)
}

const setMode = async (page, mode) => {
  await page.evaluate(`window.moho.prefs.set('display.messageMode', ${JSON.stringify(mode)})`)
  // The window reads its preferences once and hears only about other
  // windows' changes, so a reload is what makes this one see its own.
  await page.call('Page.reload')
  await until(page, 'window.__mohoShots && document.querySelector("nav[aria-label=Servers] [aria-label]")', 'the window after a reload')
  await page.call('Emulation.setDeviceMetricsOverride', { ...SIZE, deviceScaleFactor: 1, mobile: false })
  await sleep(600)
}

/**
 * Each scene puts the window into a state and is photographed there.
 * `video` scenes are recorded instead, while `act` runs.
 */
const SCENES = [
  { name: 'irc-channel-comfy', setup: async (p) => { await setMode(p, 'comfy'); await openChannel(p, '#general') } },
  {
    // History from several days, scrolled to its start: where date
    // separators belong, and where the "jump to present" control shows.
    name: 'irc-history-top',
    setup: async (p) => {
      await setMode(p, 'comfy')
      await openChannel(p, '#general')
      await p.evaluate(`document.querySelector('.messagelist-scroll').scrollTop = 0`)
      await sleep(400)
    }
  },
  { name: 'irc-channel-classic', setup: async (p) => { await setMode(p, 'classic'); await openChannel(p, '#general') } },
  { name: 'irc-channel-bubbles', setup: async (p) => { await setMode(p, 'bubbles'); await openChannel(p, '#general') } },
  {
    name: 'irc-hover-toolbar',
    setup: async (p) => {
      await setMode(p, 'comfy')
      await openChannel(p, '#general')
      const c = await centre(p, '.message-row', 'whole paragraph')
      if (c) await mouse(p, 'mouseMoved', c.x, c.y)
      await sleep(300)
    }
  },
  {
    name: 'irc-message-menu',
    setup: async (p) => {
      await openChannel(p, '#general')
      const c = await centre(p, '.message-row', 'lunch?')
      await mouse(p, 'mousePressed', c.x, c.y, 'right')
      await mouse(p, 'mouseReleased', c.x, c.y, 'right')
      await sleep(300)
    }
  },
  {
    name: 'irc-composer-reply-typing',
    setup: async (p) => {
      await openChannel(p, '#general')
      await p.evaluate(`(() => {
        const s = window.__mohoShots.state()
        const id = s.activeBufferId
        const msg = (s.messagesByBuffer[id] || []).find((m) => m.body.includes('badges'))
        if (msg) window.__mohoShots.store.startReply(msg.id, msg.from, msg.body)
        window.__mohoShots.patch({ typingByBuffer: { ...s.typingByBuffer, [id]: { nicks: ['carol', 'dave'], until: Date.now() + 60000 } } })
        return true
      })()`)
      await sleep(300)
    }
  },
  { name: 'emoji-picker', setup: async (p) => { await openChannel(p, '#general'); await p.evaluate(click('button[title="Emoji"]')); await sleep(400) } },
  {
    // Files in the tray: a card each with name and size, one marked a spoiler (#308).
    name: 'discord-tray',
    setup: async (p) => {
      await discord(false)(p)
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moho-tray-'))
      const make = (name, bytes) => { const f = path.join(dir, name); fs.writeFileSync(f, Buffer.alloc(bytes, 1)); return f }
      const files = [make('finished-amigurumi-owl.png', 482_000), make('pattern-notes.pdf', 1_900_000), make('workshop-clip.mp4', 12_400_000), make('granny-square-closeup.jpg', 233_000)]
      await p.evaluate(`(async () => {
        const art = (a, b, label) => new Promise((resolve) => {
          const c = document.createElement('canvas'); c.width = 320; c.height = 200
          const g = c.getContext('2d'); const grad = g.createLinearGradient(0, 0, 320, 200); grad.addColorStop(0, a); grad.addColorStop(1, b)
          g.fillStyle = grad; g.fillRect(0, 0, 320, 200); g.fillStyle = '#fff'; g.font = '28px sans-serif'; g.textAlign = 'center'; g.fillText(label, 160, 108)
          c.toBlob((blob) => resolve(blob))
        })
        const owl = await art('#e0a43a', '#b0457a', 'owl')
        const squares = await art('#3a8fe0', '#4a2f9a', 'squares')
        const mk = (blob, name) => new File([blob], name, { type: 'image/png' })
        window.dispatchEvent(new CustomEvent('moho:stage-files', { detail: [
          { path: ${JSON.stringify(files[0])}, file: mk(owl, 'owl.png') },
          { path: ${JSON.stringify(files[1])} },
          { path: ${JSON.stringify(files[2])} },
          { path: ${JSON.stringify(files[3])}, file: mk(squares, 'squares.png') }
        ] }))
      })()`)
      await sleep(700)
      // The last one hidden, and the pointer over the first.
      await p.evaluate(`document.querySelectorAll('.staged-card')[3].querySelector('.staged-action[title="Mark as spoiler"]').click()`)
      const c = await centre(p, '.staged-card', 'owl')
      if (c) await mouse(p, 'mouseMoved', c.x, c.y)
      await sleep(400)
    },
    clip: { x: 277, y: 560, width: 823, height: 240 }
  },
  {
    // A file dropped on the window (#308): the old build asked first and sent it on its own;
    // the new one puts it in the tray.
    name: 'discord-drop',
    setup: async (p) => {
      await discord(false)(p)
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moho-drop-'))
      const file = path.join(dir, 'finished-amigurumi-owl.png')
      execFileSync('convert', ['-size', '480x300', 'gradient:#e0a43a-#b0457a', file])
      const drag = (type) => p.call('Input.dispatchDragEvent', { type, x: 600, y: 300, data: { items: [], files: [file], dragOperationsMask: 1 } })
      await drag('dragEnter')
      await drag('dragOver')
      await sleep(300)
      await drag('drop')
      await sleep(800)
    }
  },
  {
    // Only for the "before" half of #308: the old tray, drawn from the markup it had, since
    // nothing in the old build could put a file there without a dialog or the clipboard.
    name: 'discord-tray-before',
    setup: async (p) => {
      await discord(false)(p)
      await p.evaluate(`(() => {
        const mk = (a, b) => { const c = document.createElement('canvas'); c.width = 144; c.height = 144; const g = c.getContext('2d'); const grad = g.createLinearGradient(0, 0, 144, 144); grad.addColorStop(0, a); grad.addColorStop(1, b); g.fillStyle = grad; g.fillRect(0, 0, 144, 144); return c.toDataURL() }
        const tile = (inner) => '<div class="staged-thumb">' + inner + '<button type="button" class="staged-remove" title="Remove"><span class="icon" style="font-size:13px;width:13px;height:13px;color:var(--error)">close</span></button></div>'
        const html = '<div class="composer-attachments">' +
          tile('<img src="' + mk('#e0a43a', '#b0457a') + '">') +
          tile('<div class="staged-file"><span class="icon">description</span><span class="small ellipsis">pattern-notes.pdf</span></div>') +
          tile('<div class="staged-file"><span class="icon">description</span><span class="small ellipsis">workshop-clip.mp4</span></div>') +
          tile('<img src="' + mk('#3a8fe0', '#4a2f9a') + '">') + '</div>'
        document.querySelector('.composer-row').insertAdjacentHTML('beforebegin', html)
      })()`)
      await sleep(400)
    },
    clip: { x: 277, y: 560, width: 823, height: 240 }
  },
  {
    // The "+" with more than a file in it (#306): Matrix's place and poll live here now.
    name: 'matrix-plus-menu',
    setup: async (p) => {
      await openChannel(p, '#general')
      await p.evaluate(`(() => {
        const s = window.__mohoShots.state()
        window.__mohoShots.patch({ accounts: s.accounts.map((a) => ({ ...a, service: 'matrix' })) })
        return true
      })()`)
      await sleep(400)
      await p.evaluate(`document.querySelector('.composer-input').focus()`)
      await p.call('Input.insertText', { text: 'with a place and a poll under the plus' })
      await p.evaluate(click('.composer-plus'))
      await sleep(500)
    },
    clip: { x: 277, y: 520, width: 823, height: 280 }
  },
  {
    // Walked with the arrow keys, with the skin tones open (#313).
    name: 'emoji-picker-keys',
    setup: async (p) => {
      await openChannel(p, '#general')
      await p.evaluate(click('button[title="Emoji"]'))
      await sleep(400)
      for (const [key, code, vk] of [['ArrowDown', 'ArrowDown', 40], ['ArrowRight', 'ArrowRight', 39], ['ArrowRight', 'ArrowRight', 39], ['ArrowDown', 'ArrowDown', 40]]) {
        for (const type of ['keyDown', 'keyUp']) await p.call('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk })
        await sleep(120)
      }
      await p.evaluate(`document.querySelector('.emoji-tone-button')?.click()`)
      await sleep(400)
    }
  },
  {
    // The mentions page (#314): filters, days, two lines, put away.
    name: 'mentions-page',
    setup: async (p) => {
      await discord(false)(p)
      await p.evaluate(`(() => {
        const now = Math.floor(Date.now() / 1000)
        const m = (id, bufferId, from, body, ts) => ({ id, bufferId, from, senderId: from, body, ts, isAction: false, isHighlight: true, kind: 'chat', isOwn: false })
        window.__mohoShots.patch({
          mentions: [
            m('x1', 'discord:shots|c3', 'Gaunt King', 'perfect - @Salastil you are a lifesaver, and could you also bring the felt kits on Saturday when you come by the fair? we are short on the small ones', now - 600),
            m('x2', 'discord:shots|c5', 'Clarence', '@Salastil the new screenshots are up, can you check the colours before I post them?', now - 3 * 3600),
            m('x3', 'discord:shots|c3', 'Wren', 'ping @Salastil', now - 30 * 3600),
            m('x4', 'discord:shots|c8', 'Fern', '@Salastil did the cats channel get the new pinned rules?', now - 54 * 3600)
          ],
          lastReadTs: { 'discord:shots|c3': now - 2 * 3600, 'discord:shots|c5': now - 4 * 3600, 'discord:shots|c8': now }
        })
        window.__mohoShots.store.selectGroup && window.__mohoShots.store.selectGroup('~mentions')
        return true
      })()`)
      await sleep(500)
    }
  },
  {
    // Room settings as a dialog with pages (#324); the room's answers are not there to read, so it shows its frame.
    name: 'room-settings-dialog',
    setup: async (p) => {
      await openChannel(p, '#general')
      await p.evaluate(`(() => { const s = window.__mohoShots.state(); window.__mohoShots.patch({ buffers: s.buffers.map((b) => b.id === s.activeBufferId ? { ...b, accountId: 'matrix:' + b.accountId } : b), accounts: s.accounts.map((a) => ({ ...a, id: 'matrix:' + a.id, service: 'matrix' })) }); return true })()`)
      await sleep(500)
      await p.evaluate(click('button[title="What this room keeps"]'))
      await sleep(700)
    }
  },
  { name: 'mentions-inbox', setup: async (p) => { await p.evaluate(click('button[title="Mentions"]')); await sleep(400) } },
  {
    name: 'modal-export',
    setup: async (p) => {
      await openChannel(p, '#general')
      await p.evaluate(click('.header-nameplate'))
      await sleep(300)
      await p.evaluate(click('.context-menu-item', 'Export'))
      await sleep(600)
    }
  },
  {
    // The date fields appear only with "A range" chosen; they are what had no border colour (#268).
    name: 'modal-export-range',
    setup: async (p) => {
      await openChannel(p, '#general')
      await p.evaluate(click('.header-nameplate'))
      await sleep(300)
      await p.evaluate(click('.context-menu-item', 'Export'))
      await sleep(500)
      await p.evaluate(`[...document.querySelectorAll('.reason-prompt label')].find((l) => l.innerText.includes('A range'))?.click()`)
      await sleep(400)
    }
  },
  {
    // The pointer over a channel and over a member: how visible a hover is.
    name: 'irc-hover-rows',
    setup: async (p) => {
      await openChannel(p, '#general')
      const c = await centre(p, '.buffer-row', 'dev')
      if (c) await mouse(p, 'mouseMoved', c.x, c.y)
      await sleep(300)
    },
    clip: { x: 0, y: 44, width: 420, height: 300 }
  },
  {
    name: 'irc-hover-member',
    setup: async (p) => {
      await openChannel(p, '#general')
      const c = await centre(p, '.nick-row', 'carol')
      if (c) await mouse(p, 'mouseMoved', c.x, c.y)
      await sleep(300)
    },
    clip: { x: 860, y: 44, width: 420, height: 300 }
  },
  {
    name: 'toasts',
    setup: async (p) => {
      await openChannel(p, '#general')
      await p.evaluate(`(() => { const t = window.__mohoShots.store; t.toast('info', 'Copied to the clipboard'); t.toast('success', 'Link copied'); t.toast('error', "Couldn't send: the connection dropped"); t.toast('error', "Couldn't send: the connection dropped"); t.toast('error', "Couldn't send: the connection dropped"); return true })()`)
      await sleep(300)
    }
  },
  { name: 'settings-general', setup: async (p) => { await p.evaluate(`window.__mohoShots.store.setActivePanel('settings')`); await sleep(400) } },
  {
    name: 'settings-tor',
    setup: async (p) => {
      await p.evaluate(`window.__mohoShots.store.setActivePanel('settings')`)
      await sleep(300)
      await p.evaluate(click('.settings-rail-item', 'Tor'))
      await sleep(400)
    }
  },
  {
    // Searching across every page (#319).
    name: 'settings-search',
    setup: async (p) => {
      await openChannel(p, '#general')
      await p.evaluate(`window.__mohoShots.store.setActivePanel('settings')`)
      await sleep(400)
      await p.evaluate(`document.querySelector('.settings-search-input').focus()`)
      await p.call('Input.insertText', { text: 'timestamp' })
      await sleep(500)
    }
  },
  {
    name: 'settings-appearance',
    setup: async (p) => {
      await openChannel(p, '#general')
      await p.evaluate(`window.__mohoShots.store.setActivePanel('settings')`)
      await sleep(300)
      await p.evaluate(click('.settings-rail-item', 'Appearance'))
      await sleep(500)
    }
  },
  {
    // Compact spacing, 12-hour clock, a larger zoom (#320).
    name: 'appearance-compact',
    setup: async (p) => {
      await p.evaluate(`window.moho.prefs.set('appearance.density', 'compact'), window.moho.prefs.set('display.hourFormat', '12'), window.moho.prefs.set('appearance.zoom', 1.15)`)
      // Read at start, as a window opened later would.
      await p.evaluate(`location.reload()`)
      await sleep(2500)
      await openChannel(p, '#general')
      await sleep(900)
    }
  },
  {
    name: 'settings-notifications',
    setup: async (p) => {
      await openChannel(p, '#general')
      await p.evaluate(`window.__mohoShots.store.setActivePanel('settings')`)
      await sleep(300)
      await p.evaluate(click('.settings-rail-item', 'Notifications'))
      await sleep(500)
    }
  },
  {
    name: 'settings-keybinds',
    setup: async (p) => {
      await openChannel(p, '#general')
      await p.evaluate(`window.__mohoShots.store.setActivePanel('settings')`)
      await sleep(300)
      await p.evaluate(click('.settings-rail-item', 'Keybinds'))
      await sleep(500)
    }
  },
  {
    // Join: which account it is for, first, and a button that says Join (#323).
    name: 'join-picker',
    setup: async (p) => {
      await discord(false)(p)
      await p.evaluate(`window.__mohoShots.store.setActivePanel('join', 'discord:shots')`)
      await sleep(600)
    }
  },
  {
    // An account card open: Remove lives in a danger zone at its foot (#323).
    name: 'accounts-expanded',
    setup: async (p) => {
      await openChannel(p, '#general')
      await p.evaluate(`window.__mohoShots.store.setActivePanel('accounts')`)
      await sleep(500)
      await p.evaluate(`document.querySelector('.account-card .icon-button[title="Settings"]')?.click()`)
      await sleep(500)
      await p.evaluate(`(document.querySelector('.settings .panel') || document.querySelector('.panel')).scrollTop = 1e6`)
      await sleep(300)
    }
  },
  { name: 'settings-accounts', setup: async (p) => { await p.evaluate(`window.__mohoShots.store.setActivePanel('accounts')`); await sleep(400) } },
  { name: 'discord-guild', setup: discord(false) },
  {
    name: 'discord-voice-panel',
    setup: async (p) => {
      await discord(true)(p)
      // Somebody speaking, and a healthy connection.
      await p.evaluate(`window.__shotsLevels = { micPeak: 0.05, rttMs: 42 }, true`)
      await sleep(500)
    },
    clip: { x: 0, y: 480, width: 300, height: 320 }
  },
  {
    // Right-clicking a server's own category heading, which used to open nothing (#286).
    name: 'discord-category-menu',
    setup: async (p) => {
      await discord(false)(p)
      const c = await centre(p, '.category-head', 'ANIMALS')
      if (c) {
        await mouse(p, 'mousePressed', c.x, c.y, 'right')
        await mouse(p, 'mouseReleased', c.x, c.y, 'right')
      }
      await sleep(300)
    },
    clip: { x: 0, y: 44, width: 420, height: 420 }
  },
  {
    name: 'discord-server-menu',
    setup: async (p) => {
      await discord(false)(p)
      const c = await centre(p, '.rail-tile', '')
      const tile = await p.evaluate(`(() => { const el = document.querySelector('[title="Moho Dev"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
      const at = tile ?? c
      if (at) {
        await mouse(p, 'mousePressed', at.x, at.y, 'right')
        await mouse(p, 'mouseReleased', at.x, at.y, 'right')
      }
      await sleep(300)
    },
    clip: { x: 0, y: 44, width: 420, height: 300 }
  },
  {
    // Ctrl+K with nothing typed: what is waiting first (#287).
    name: 'discord-switcher',
    setup: async (p) => {
      await discord(false)(p)
      await pressKey(p, 'k', 'KeyK', 2)
      await sleep(400)
    }
  },
  {
    name: 'discord-switcher-query',
    setup: async (p) => {
      await discord(false)(p)
      await pressKey(p, 'k', 'KeyK', 2)
      await sleep(300)
      await p.call('Input.insertText', { text: 'gen' })
      await sleep(400)
    }
  },
  {
    name: 'discord-voice-panel-poor',
    setup: async (p) => {
      await discord(true)(p)
      await p.evaluate(`window.__shotsLevels = { micPeak: 0.13, rttMs: 210 }, true`)
      await sleep(500)
    },
    clip: { x: 0, y: 480, width: 300, height: 320 }
  },
  {
    // The pointer over a reply (#296) and over a name (#297): both are links now.
    name: 'discord-reply-hover',
    setup: async (p) => {
      await discord(false)(p)
      const c = await centre(p, '.reply-preview', 'man the table')
      if (c) await mouse(p, 'mouseMoved', c.x, c.y)
      await sleep(300)
    },
    clip: { x: 277, y: 260, width: 640, height: 90 }
  },
  {
    // The reply bar (#307): its own surface, the author's face, the @ switch.
    name: 'discord-reply-bar',
    setup: async (p) => {
      await discord(false)(p)
      await p.evaluate(`(() => {
        const s = window.__mohoShots.state()
        const msg = (s.messagesByBuffer[s.activeBufferId] || []).find((m) => m.body.includes('table'))
        if (msg) window.__mohoShots.store.startReply(msg.id, msg.from, msg.body)
        return true
      })()`)
      await sleep(400)
    },
    clip: { x: 277, y: 640, width: 1000, height: 160 }
  },
  {
    name: 'discord-name-hover',
    setup: async (p) => {
      await discord(false)(p)
      const c = await centre(p, '.message-from', 'Gaunt King')
      if (c) await mouse(p, 'mouseMoved', c.x - 20, c.y)
      await sleep(300)
    },
    clip: { x: 277, y: 80, width: 640, height: 90 }
  },
  {
    // Right-click on highlighted text in a Discord message (#299).
    name: 'discord-message-menu',
    setup: async (p) => {
      await discord(false)(p)
      await p.evaluate(`(() => {
        const row = [...document.querySelectorAll('.message-row')].find((r) => r.innerText.includes('craft fair'))
        const body = row.querySelector('.message-body')
        const range = document.createRange(); range.selectNodeContents(body)
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range)
        return true
      })()`)
      const c = await centre(p, '.message-row', 'craft fair')
      await mouse(p, 'mousePressed', c.x + 120, c.y, 'right')
      await mouse(p, 'mouseReleased', c.x + 120, c.y, 'right')
      await sleep(300)
    },
    clip: { x: 277, y: 80, width: 640, height: 420 }
  },
  {
    // The pointer over your own message: Edit and Copy join the toolbar (#298).
    name: 'discord-hover-toolbar',
    setup: async (p) => {
      await discord(false)(p)
      const c = await centre(p, '.message-row', 'man the table for an hour after lunch')
      if (c) await mouse(p, 'mouseMoved', c.x + 100, c.y + 8)
      await sleep(400)
    },
    clip: { x: 277, y: 200, width: 823, height: 120 }
  },
  {
    // A folded category with unread channels in it, and muted channels (#275, #276).
    name: 'discord-folded-muted',
    setup: async (p) => {
      await discord(false)(p)
      // Muted through the window's own menu, as a person would: one quiet
      // (shitpost), one with a mention in it (screenshots).
      for (const name of ['shitpost', 'screenshots']) {
        const c = await centre(p, '.buffer-row', name)
        await mouse(p, 'mousePressed', c.x, c.y, 'right')
        await mouse(p, 'mouseReleased', c.x, c.y, 'right')
        await sleep(250)
        await p.evaluate(click('.context-menu-item', 'Mute'))
        await sleep(400)
        // A preference change makes the window ask the daemon again, which
        // knows of no such server; the staged state goes back in.
        await p.evaluate(DISCORD)
        await sleep(700)
      }
      await p.evaluate(click('.category-head', 'ANIMALS'))
      await sleep(300)
      await p.evaluate(click('.category-head', 'TEXT CHANNELS'))
      await sleep(400)
      await p.evaluate(DISCORD)
      await sleep(700)
    },
    clip: { x: 0, y: 44, width: 280, height: 360 }
  },
  // One account in each state the dots can show: the plaque's dot and the server header's (#277).
  ...[
    ['dnd', 'connected', 'dnd'],
    ['idle', 'connected', 'idle'],
    ['connecting', 'connecting', 'online'],
    ['offline', 'disconnected', 'online']
  ].flatMap(([name, state, status]) => [
    {
      name: `presence-${name}-footer`,
      setup: async (p) => {
        await discord(false)(p)
        await p.evaluate(`window.__mohoShots.patch({ accounts: window.__mohoShots.state().accounts.map((a) => a.id === 'discord:shots' ? { ...a, state: '${state}', status: '${status}' } : a) })`)
        await sleep(400)
      },
      clip: { x: 0, y: 740, width: 280, height: 60 }
    },
    {
      name: `presence-${name}-header`,
      setup: async (p) => {
        await discord(false)(p)
        await p.evaluate(`window.__mohoShots.patch({ accounts: window.__mohoShots.state().accounts.map((a) => a.id === 'discord:shots' ? { ...a, state: '${state}', status: '${status}' } : a) })`)
        await sleep(400)
      },
      clip: { x: 56, y: 48, width: 224, height: 36 }
    }
  ]),
  {
    // The rail: mention counts on server tiles and the "+" tile (#285).
    name: 'rail-tiles',
    setup: async (p) => { await discord(false)(p) },
    clip: { x: 0, y: 44, width: 280, height: 360 }
  },
  {
    name: 'rail-tooltip',
    setup: async (p) => {
      await discord(false)(p)
      const tile = await p.evaluate(`(() => { const el = document.querySelector('[aria-label="Moho Dev"]'); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
      await mouse(p, 'mouseMoved', tile.x, tile.y)
      await sleep(400)
    },
    clip: { x: 0, y: 44, width: 280, height: 160 }
  },
  {
    // Both servers filed in a folder, closed: it should still say something is waiting.
    name: 'rail-folder-closed',
    setup: async (p) => {
      await discord(false)(p)
      await p.evaluate(`window.moho.prefs.set('railFolders', [{ id: 'f1', name: 'Mine', colour: '', members: ['discord:shots|guild:1', 'discord:shots|guild:2'] }])`)
      await sleep(300)
      await p.call('Page.reload')
      await until(p, 'window.__mohoShots && document.querySelector(".buffer-row")', 'the window after a reload')
      await p.call('Emulation.setDeviceMetricsOverride', { ...SIZE, deviceScaleFactor: 1, mobile: false })
      await sleep(500)
      await p.evaluate(DISCORD)
      await sleep(900)
    },
    clip: { x: 0, y: 44, width: 280, height: 360 }
  },
  {
    // The pointer over the close button (#291): red, and the maximise glyph.
    name: 'titlebar-close-hover',
    setup: async (p) => {
      await openChannel(p, '#general')
      const c = await centre(p, '.titlebar-controls button', '')
      const close = await p.evaluate(`(() => { const b = [...document.querySelectorAll('.titlebar-controls button')].at(-1); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
      await mouse(p, 'mouseMoved', close.x, close.y)
      await sleep(300)
    },
    clip: { x: 1020, y: 0, width: 260, height: 44 }
  },
  {
    // The member list with presence (#288).
    name: 'discord-members',
    setup: async (p) => { await discord(false)(p) },
    clip: { x: 1100, y: 44, width: 180, height: 300 }
  },
  {
    // The voice channels: faces, muted and deafened marks, who is speaking, in the call (#293).
    name: 'discord-voice-list',
    setup: async (p) => {
      await discord(true)(p)
      await p.evaluate(`window.__mohoShots.patch({ voiceChannels: window.__mohoShots.state().voiceChannels.map((c) => c.id === 'v1' ? { ...c, members: [{ userId: 'Salastil', nick: 'Salastil', isSelf: true }, { userId: 'Clarence', nick: 'Clarence', isSelf: false, muted: true }, { userId: 'Wren', nick: 'Wren', isSelf: false, streaming: true }, { userId: 'Fern', nick: 'Fern', isSelf: false, deafened: true }] } : c) }), window.__shotsSpeakers = ['Wren'], true`)
      await sleep(600)
    },
    clip: { x: 0, y: 380, width: 280, height: 260 }
  },
  {
    // Restarting Tor asks first (#316).
    name: 'settings-tor-confirm',
    setup: async (p) => {
      await p.evaluate(`window.__mohoShots.store.setActivePanel('settings')`)
      await sleep(300)
      await p.evaluate(click('.settings-rail-item', 'Tor'))
      await sleep(300)
      await p.evaluate(click('button', 'Restart Tor from scratch'))
      await sleep(300)
    }
  },
  {
    // A thread beside the room: grouped replies, the plural, the display settings (#269).
    name: 'discord-thread',
    setup: async (p) => {
      await discord(false)(p)
      await p.evaluate(`(() => {
        const s = window.__mohoShots.state()
        const bufferId = 'discord:shots|c3'
        const now = Math.floor(Date.now() / 1000)
        const m = (id, from, body, mins, replyTo) => ({ id, bufferId, from, body, ts: now - mins * 60, isAction: false, isHighlight: false, kind: 'chat', isOwn: false, senderId: from, ...(replyTo ? { replyTo } : {}) })
        const thread = { id: 'm1', from: 'Gaunt King', body: '', thread: true }
        window.__mohoShots.patch({ openThread: { bufferId, rootId: 'm1', loading: false, messages: [
          m('m1', 'Gaunt King', 'anyone else going to the craft fair this weekend?', 50),
          m('t1', 'Clarence', 'yes! bringing the new amigurumi batch', 48, thread),
          m('t2', 'Clarence', 'and the felt kits', 47, thread)
        ] } })
        return true
      })()`)
      await sleep(600)
    },
    clip: { x: 760, y: 44, width: 520, height: 400 }
  },
  {
    // The thread's reply box is the room's own (#310): emoji, names, files.
    name: 'discord-thread-composer',
    setup: async (p) => {
      await SCENES.find((x) => x.name === 'discord-thread').setup(p)
      await p.evaluate(`document.querySelector('.thread-pane .composer-input')?.focus()`)
      await p.call('Input.insertText', { text: 'count me in :fi' })
      await sleep(500)
    },
    clip: { x: 760, y: 44, width: 520, height: 756 }
  },
  {
    // The status menu (a real check mark) and the cog's menu beside its button (#317).
    name: 'status-menu',
    setup: async (p) => {
      await openChannel(p, '#general')
      await realClick(p, '.user-identity-button')
      await sleep(400)
    },
    clip: { x: 0, y: 500, width: 420, height: 300 }
  },
  {
    name: 'cog-menu',
    setup: async (p) => {
      await openChannel(p, '#general')
      await realClick(p, '.rail-cog')
      await sleep(400)
    },
    clip: { x: 0, y: 600, width: 420, height: 200 }
  },
  {
    // The lists that open over the box while a name or an emoji is typed (#309).
    name: 'discord-autocomplete-mention',
    setup: async (p) => {
      await discord(false)(p)
      const face = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#e0a43a"/><circle cx="16" cy="13" r="6" fill="#fff"/><rect x="6" y="21" width="20" height="12" rx="6" fill="#fff"/></svg>')
      await p.evaluate(`(() => {
        const s = window.__mohoShots.state()
        const id = s.activeBufferId
        const m = (nick, extra = {}) => ({ nick, userId: nick, status: 'online', ...extra })
        window.__mohoShots.patch({ presenceByBuffer: { ...s.presenceByBuffer, [id]: [m('Clarence', { avatarUrl: ${JSON.stringify(face)} }), m('Cora'), m('Gaunt King'), m('Wren')] } })
        return true
      })()`)
      await p.evaluate(`document.querySelector('.composer-input').focus()`)
      await p.call('Input.insertText', { text: 'thanks @c' })
      await sleep(500)
    },
    clip: { x: 277, y: 420, width: 823, height: 380 }
  },
  {
    name: 'discord-autocomplete-emoji',
    setup: async (p) => {
      await discord(false)(p)
      await p.evaluate(`document.querySelector('.composer-input').focus()`)
      await p.call('Input.insertText', { text: 'that was :fi' })
      await sleep(500)
    },
    clip: { x: 277, y: 420, width: 823, height: 380 }
  },
  {
    // Pins for Discord (#311): the banner over the log, and the count in the header.
    name: 'discord-pinned-banner',
    setup: async (p) => {
      await discord(false)(p)
      await p.evaluate(`(() => {
        const shots = window.__mohoShots
        const s = shots.state()
        const id = s.activeBufferId
        const list = s.messagesByBuffer[id] || []
        const pick = ['craft fair', 'amigurumi', 'I can man'].map((t) => list.find((m) => m.body.includes(t))).filter(Boolean)
        shots.patch({ pinnedRows: { ...s.pinnedRows, [id]: pick }, pinnedMessages: { ...s.pinnedMessages, [id]: pick.map((m) => m.id) } })
        return true
      })()`)
      await sleep(600)
    },
    clip: { x: 277, y: 44, width: 823, height: 260 }
  },
  {
    // The sentence over a reaction (#303). Names come from the service on request; with the staged
    // account there is none to ask, so this shows what is said before they arrive.
    name: 'discord-reaction-tip',
    setup: async (p) => {
      await discord(false)(p)
      const c = await centre(p, '.reaction-pill', '3')
      if (c) await mouse(p, 'mouseMoved', c.x, c.y)
      await sleep(600)
    },
    clip: { x: 277, y: 60, width: 640, height: 260 }
  },
  {
    // The footer (#290): muted and deafened are red, and the status is a popout with its own colours,
    // a custom status and "apply to all".
    name: 'discord-footer-muted',
    setup: async (p) => {
      await discord(false)(p)
      await p.evaluate(`(() => { const s = window.__mohoShots.state(); window.__mohoShots.patch({ voicePrefs: { ...s.voicePrefs, micMuted: true, deafened: true } }); return true })()`)
      await sleep(500)
    },
    clip: { x: 0, y: 700, width: 330, height: 100 }
  },
  {
    name: 'discord-status-popout',
    setup: async (p) => {
      await discord(false)(p)
      await p.evaluate(click('.user-identity-button'))
      await sleep(600)
    },
    clip: { x: 0, y: 380, width: 340, height: 420 }
  },
  {
    // On a service with no voice the footer keeps its shape: the buttons are there, greyed.
    name: 'irc-footer',
    setup: async (p) => {
      await openChannel(p, '#general')
      await sleep(300)
    },
    clip: { x: 0, y: 700, width: 330, height: 100 }
  },
  {
    // The header row across the three columns, with the channel's topic in it (#289).
    name: 'discord-header-topic',
    setup: async (p) => {
      await discord(false)(p)
      await p.evaluate(`(() => {
        const s = window.__mohoShots.state()
        window.__mohoShots.patch({ buffers: s.buffers.map((b) => b.id === s.activeBufferId ? { ...b, topic: 'General chatter for the shop. Fair dates and pattern swaps are pinned. Be kind. https://example.org/rules' } : b) })
        return true
      })()`)
      await sleep(500)
    },
    clip: { x: 0, y: 44, width: 1280, height: 70 }
  },
  {
    name: 'discord-header-topic-open',
    setup: async (p) => {
      await discord(false)(p)
      await p.evaluate(`(() => {
        const s = window.__mohoShots.state()
        window.__mohoShots.patch({ buffers: s.buffers.map((b) => b.id === s.activeBufferId ? { ...b, topic: 'General chatter for the shop.\\nFair dates and pattern swaps are pinned.\\nBe kind. https://example.org/rules' } : b) })
        return true
      })()`)
      await sleep(400)
      await p.evaluate(click('.header-topic'))
      await sleep(500)
    },
    clip: { x: 277, y: 44, width: 823, height: 260 }
  },
  {
    // The shared dialog frame (#315): the screen picker had no way out but a click outside it.
    name: 'dialog-screen-picker',
    setup: async (p) => {
      await discord(false)(p)
      await p.evaluate(`(() => {
        const thumb = (a, b, l) => 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><defs><linearGradient id="g"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/><text x="160" y="100" font-size="28" font-family="sans-serif" fill="#fff" text-anchor="middle">' + l + '</text></svg>')
        window.__mohoShots.patch({ screenSources: [
          { id: 's1', name: 'Entire screen', thumbnail: thumb('#2b5876', '#4e4376', 'screen') },
          { id: 's2', name: 'moho', thumbnail: thumb('#e0a43a', '#b0457a', 'moho') },
          { id: 's3', name: 'Pattern notes - Firefox', thumbnail: thumb('#3ae0a4', '#1f6f5a', 'browser') }
        ] })
        return true
      })()`)
      await sleep(600)
    }
  },
  {
    name: 'dialog-poll',
    setup: async (p) => {
      await openChannel(p, '#general')
      await p.evaluate(`(() => { const s = window.__mohoShots.state(); window.__mohoShots.patch({ accounts: s.accounts.map((a) => ({ ...a, service: 'matrix' })) }); return true })()`)
      await sleep(400)
      await p.evaluate(click('.composer-plus'))
      await sleep(300)
      await p.evaluate(click('.context-menu-item', 'poll'))
      await sleep(600)
    }
  },
  {
    // Two calls at once, one from each service (#325): stacked, in one style.
    name: 'incoming-calls',
    setup: async (p) => {
      await discord(false)(p)
      await p.evaluate(`(() => {
        const s = window.__mohoShots.state()
        window.__mohoShots.patch({
          incomingCalls: [{ bufferId: 'discord:shots|c3', accountId: 'discord:shots' }],
          ringingCall: { accountId: 'discord:shots', bufferId: 'discord:shots|c8', callId: 'x1', from: 'Wren', video: true, offerSdp: '', expires: Date.now() + 60000 }
        })
        return true
      })()`)
      await sleep(600)
    },
    clip: { x: 0, y: 560, width: 460, height: 240 }
  },
  {
    // Where the box would be, in Discord's own notices (#328).
    name: 'discord-official-dm',
    setup: async (p) => {
      await discord(false)(p)
      await p.evaluate(`(() => {
        const shots = window.__mohoShots
        const s = shots.state()
        const id = s.activeBufferId
        const now = Math.floor(Date.now() / 1000)
        const notice = (i, title, description, footer, fields) => ({ id: 'n' + i, bufferId: id, from: 'Discord', senderId: 'Discord', body: '', ts: now - (4 - i) * 600, isAction: false, isHighlight: false, kind: 'chat', isOwn: false,
          embeds: [{ title, description, footer, fields, color: 14423100 }] })
        shots.patch({
          buffers: s.buffers.map((b) => b.id === id ? { ...b, readOnly: 'This chat is reserved for official Discord notifications.' } : b),
          messagesByBuffer: { ...s.messagesByBuffer, [id]: [notice(1, 'You broke Discord community guidelines', 'We have taken action that affects your account.', 'Learn more at discord.com/safety'), notice(2, 'We removed a violation from your account', 'We reviewed a violation regarding our policy and determined it does not violate our community guidelines.', undefined, [{ name: 'Reference', value: 'Case 4471' }])] }
        })
        return true
      })()`)
      await sleep(600)
    },
    clip: { x: 277, y: 160, width: 823, height: 640 }
  },
  {
    // A channel that can be read and not written in (#328).
    name: 'discord-read-only-channel',
    setup: async (p) => {
      await discord(false)(p)
      await p.evaluate(`(() => { const s = window.__mohoShots.state(); window.__mohoShots.patch({ buffers: s.buffers.map((b) => b.id === s.activeBufferId ? { ...b, readOnly: 'You do not have permission to send messages in this channel.' } : b) }); return true })()`)
      await sleep(500)
    },
    clip: { x: 277, y: 600, width: 823, height: 200 }
  },
  {
    name: 'discord-media-grid',
    setup: async (p) => {
      await discord(false)(p)
      await stageGrids(p)
      await p.evaluate(`document.querySelectorAll('.media-grid')[0]?.scrollIntoView({ block: 'start' })`)
      await sleep(500)
    }
  },
  {
    name: 'discord-media-grid-more',
    setup: async (p) => {
      await discord(false)(p)
      await stageGrids(p)
      await p.evaluate(`document.querySelector('.messagelist-scroll').scrollTop = 1e9`)
      await sleep(500)
    }
  },
  {
    // The viewer with pictures beside it (#312): stepped through, zoomed with the wheel.
    name: 'discord-lightbox',
    setup: async (p) => {
      await discord(false)(p)
      await stageLightbox(p)
      const c = await centre(p, '.media-embed-wrap', '')
      await p.evaluate(`document.querySelectorAll('.media-embed-wrap img')[1].click()`)
      await sleep(900)
    }
  },
  {
    name: 'discord-lightbox-zoomed',
    setup: async (p) => {
      await discord(false)(p)
      await stageLightbox(p)
      await p.evaluate(`document.querySelectorAll('.media-embed-wrap img')[1].click()`)
      await sleep(800)
      for (let i = 0; i < 6; i++) {
        await p.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 760, y: 330, deltaX: 0, deltaY: -120 })
        await sleep(60)
      }
      await sleep(400)
    }
  },
  {
    // Three lines typed with Shift+Enter (#305).
    name: 'composer-multiline',
    setup: async (p) => {
      await openChannel(p, '#general')
      await p.evaluate(`document.querySelector('.composer-input').focus()`)
      const enter = async (mods) => {
        for (const type of ['keyDown', 'keyUp']) {
          await p.call('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: mods, ...(type === 'keyDown' ? { text: '\r' } : {}) })
        }
        await sleep(120)
      }
      await p.call('Input.insertText', { text: 'Agenda for tonight:' })
      await enter(8)
      await p.call('Input.insertText', { text: '1. release notes' })
      await enter(8)
      await p.call('Input.insertText', { text: '2. the open issues' })
      await sleep(300)
    },
    clip: { x: 277, y: 560, width: 823, height: 240 }
  },
  // Motion, recorded rather than photographed.
  {
    name: 'motion-hover-rows',
    video: 2500,
    setup: async (p) => { await setMode(p, 'comfy'); await openChannel(p, '#general') },
    act: async (p) => {
      for (const text of ['#random', '#dev', '#announcements', '#general']) {
        const c = await centre(p, '.buffer-row', text)
        if (c) await mouse(p, 'mouseMoved', c.x, c.y)
        await sleep(350)
      }
      for (const text of ['morning all', 'today is the day', 'lunch?']) {
        const c = await centre(p, '.message-row', text)
        if (c) await mouse(p, 'mouseMoved', c.x, c.y)
        await sleep(350)
      }
    }
  },
  {
    name: 'motion-menu-and-modal',
    video: 2500,
    setup: async (p) => { await openChannel(p, '#general') },
    act: async (p) => {
      await sleep(200)
      await p.evaluate(click('.header-nameplate'))
      await sleep(700)
      await p.evaluate(click('.context-menu-item', 'Export'))
      await sleep(900)
    }
  },
  {
    name: 'motion-fold',
    video: 2600,
    setup: async (p) => { await discord(false)(p) },
    act: async (p) => {
      await sleep(300)
      await p.evaluate(click('.category-head', 'ANIMALS'))
      await sleep(900)
      await p.evaluate(click('.category-head', 'ANIMALS'))
      await sleep(700)
    }
  },
  {
    // A message arriving, and a reaction landing (#283).
    name: 'motion-message-and-reaction',
    video: 2800,
    setup: async (p) => { await discord(false)(p) },
    act: async (p) => {
      await sleep(400)
      await p.evaluate(`(() => {
        const s = window.__mohoShots.state()
        const id = 'discord:shots|c3'
        const now = Math.floor(Date.now() / 1000)
        const list = s.messagesByBuffer[id]
        window.__mohoShots.patch({ messagesByBuffer: { ...s.messagesByBuffer, [id]: [...list, { id: 'live1', bufferId: id, from: 'Clarence', body: 'this one just arrived', ts: now, isAction: false, isHighlight: false, kind: 'chat', isOwn: false, senderId: 'Clarence' }] } })
        return true
      })()`)
      await sleep(1000)
      await p.evaluate(`(() => {
        const s = window.__mohoShots.state()
        const id = 'discord:shots|c3'
        window.__mohoShots.patch({ messagesByBuffer: { ...s.messagesByBuffer, [id]: s.messagesByBuffer[id].map((m) => m.id === 'm1' ? { ...m, reactions: m.reactions.map((r) => r.emoji === '👍' ? { ...r, count: r.count + 1 } : r) } : m) } })
        return true
      })()`)
      await sleep(900)
    }
  },
  {
    name: 'motion-toast',
    video: 2000,
    setup: async (p) => { await openChannel(p, '#general') },
    act: async (p) => {
      await sleep(300)
      await p.evaluate(`window.__mohoShots.store.toast('info', 'Copied to the clipboard')`)
      await sleep(1200)
    }
  }
]

// --- capture -----------------------------------------------------------------

async function photograph(page, file, clip) {
  const { data } = await page.call('Page.captureScreenshot', {
    format: 'png',
    ...(clip ? { clip: { ...clip, scale: 1 } } : {})
  })
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
}

/** Records the page while `act` runs, as an mp4 at the frames' own timing. */
async function record(page, file, ms, act) {
  const frames = []
  const off = page.on('Page.screencastFrame', (f) => {
    frames.push({ data: f.data, t: f.metadata.timestamp })
    void page.call('Page.screencastFrameAck', { sessionId: f.sessionId })
  })
  await page.call('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: SIZE.width, maxHeight: SIZE.height })
  const started = Date.now()
  await act(page)
  await sleep(Math.max(0, ms - (Date.now() - started)))
  await page.call('Page.stopScreencast')
  off()
  if (frames.length === 0) return false

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'moho-rec-'))
  const lines = []
  frames.forEach((f, i) => {
    const name = path.join(work, `f${String(i).padStart(5, '0')}.png`)
    fs.writeFileSync(name, Buffer.from(f.data, 'base64'))
    const next = frames[i + 1]?.t ?? f.t + 0.5
    lines.push(`file '${name}'`, `duration ${Math.max(0.01, next - f.t).toFixed(3)}`)
  })
  // The concat demuxer ignores the last duration unless the file is repeated.
  lines.push(`file '${path.join(work, `f${String(frames.length - 1).padStart(5, '0')}.png`)}'`)
  fs.writeFileSync(path.join(work, 'list.txt'), lines.join('\n'))
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(work, 'list.txt'),
    '-vf', 'fps=30,pad=ceil(iw/2)*2:ceil(ih/2)*2', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', file
  ])
  fs.rmSync(work, { recursive: true, force: true })
  return true
}

// --- the comparison page -----------------------------------------------------

function compare(a, b) {
  const left = path.join(DIR, a)
  const right = path.join(DIR, b)
  const names = [...new Set([...fs.readdirSync(left), ...fs.readdirSync(right)])]
    .filter((n) => /\.(png|mp4)$/.test(n))
    .sort()
  const cell = (dir, label, name) => {
    const file = path.join(dir, name)
    if (!fs.existsSync(file)) return `<figure><figcaption>${label}</figcaption><p class="none">not captured</p></figure>`
    const src = `file://${file}`
    const media = name.endsWith('.mp4')
      ? `<video src="${src}" controls loop muted autoplay playsinline></video>`
      : `<a href="${src}"><img src="${src}" alt="${label} ${name}"></a>`
    return `<figure><figcaption>${label}</figcaption>${media}</figure>`
  }
  const html = `<!doctype html><meta charset="utf-8"><title>moho UI: ${a} / ${b}</title>
<style>
  :root { color-scheme: dark; --bg:#101418; --fg:#e0e2e8; --muted:#949ba4; --line:#2a2e34 }
  body { margin:0; padding:24px 16px; background:var(--bg); color:var(--fg); font:14px/1.5 system-ui, sans-serif }
  h1 { font-size:20px; margin:0 0 4px } p.sub { color:var(--muted); margin:0 0 24px }
  section { border-top:1px solid var(--line); padding:16px 0 }
  h2 { font-size:15px; margin:0 0 12px; font-family:ui-monospace, monospace }
  .pair { display:grid; grid-template-columns:repeat(auto-fit, minmax(420px, 1fr)); gap:16px }
  figure { margin:0; min-width:0 } figcaption { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.06em; margin-bottom:6px }
  img, video { width:100%; border:1px solid var(--line); border-radius:6px; display:block }
  .none { color:var(--muted); font-style:italic }
</style>
<h1>moho UI, ${a} and ${b}</h1><p class="sub">${names.length} captures, ${new Date().toLocaleString()}</p>
${names.map((n) => `<section><h2>${n.replace(/\.(png|mp4)$/, '')}</h2><div class="pair">${cell(left, a, n)}${cell(right, b, n)}</div></section>`).join('\n')}`
  const out = path.join(DIR, `compare-${a}-${b}.html`)
  fs.writeFileSync(out, html)
  console.log(out)
}

// --- main ----------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const flag = (name) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  if (args[0] === '--compare') return compare(args[1] ?? 'before', args[2] ?? 'after')

  const out = path.join(DIR, flag('--out') ?? 'shots')
  const only = flag('--only')
  fs.mkdirSync(out, { recursive: true })
  const scenes = SCENES.filter((s) => !only || s.name.includes(only))

  const irc = await fakeIrc({ people: PEOPLE, caps: ['server-time'], onJoin })
  const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
  const failed = []
  try {
    await until(page, 'window.__mohoShots', 'the test-only state hook (is the app built from this tree?)')
    await page.call('Emulation.setDeviceMetricsOverride', { ...SIZE, deviceScaleFactor: 1, mobile: false })
    await openIrcChannel(page, { port: irc.address().port, nick: NICK, channels: CHANNELS, waitFor: 'lunch?' })

    for (const scene of scenes) {
      try {
        // Every scene starts from the same place: nothing open, the IRC
        // network showing, the mouse out of the way.
        await escape(page)
        await page.evaluate(`window.__mohoShots.store.setActivePanel(''), window.__mohoShots.patch({ toasts: [], typingByBuffer: {}, replyingTo: null })`)
        await mouse(page, 'mouseMoved', SIZE.width - 1, SIZE.height - 1)
        await scene.setup(page)
        if (scene.video) {
          const ok = await record(page, path.join(out, `${scene.name}.mp4`), scene.video, scene.act)
          console.log(`  ${ok ? 'rec ' : 'none'}  ${scene.name}`)
        } else {
          await sleep(250)
          await photograph(page, path.join(out, `${scene.name}.png`), scene.clip)
          console.log(`  shot  ${scene.name}`)
        }
      } catch (e) {
        failed.push(`${scene.name}: ${e.message}`)
        console.log(`  FAIL  ${scene.name}: ${e.message}`)
      }
      // The Discord-shaped state goes again before the next scene: a reload
      // brings back only what the daemon really holds.
      if (scene.name.startsWith('discord')) {
        await page.call('Page.reload')
        await until(page, 'window.__mohoShots && document.querySelector(".buffer-row")', 'the window after a reload')
        await page.call('Emulation.setDeviceMetricsOverride', { ...SIZE, deviceScaleFactor: 1, mobile: false })
      }
    }
  } finally {
    await stop()
    irc.close()
  }
  console.log(`\n${scenes.length - failed.length} of ${scenes.length} captured in ${out}`)
  if (failed.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
