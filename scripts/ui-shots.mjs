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
      await p.evaluate(`window.__mohoShots.store.toast('info', 'Copied to the clipboard'), window.__mohoShots.store.toast('error', "Couldn't send: the connection dropped")`)
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
