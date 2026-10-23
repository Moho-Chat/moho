#!/usr/bin/env node
/**
 * A Telegram account's page with its conversations under the account's chat folders, and the changes the window asks
 * Telegram for: filing a conversation by dragging it to another folder, putting the folders in another order, making a
 * category (which is a folder once it has a conversation in it), renaming and deleting one - and that what Telegram
 * says next is what is drawn. The daemon's answers are stood in for here, in a scratch home on a fake IRC server.
 *
 *   node scripts/check-telegram-folders-ui.mjs <output directory>
 */
import fs from 'node:fs'
import path from 'node:path'
import { fakeIrc, launchApp, openIrcChannel, sleep } from './lib/harness.mjs'

const out = process.argv[2] ?? '.'
fs.mkdirSync(out, { recursive: true })
const irc = await fakeIrc({ people: ['alice'], onJoin: (c, _n, send) => send(`:alice!u@h PRIVMSG ${c} :hello there`) })
const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const ev = (code) => page.evaluate(code)
const shot = async (name) => {
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
}
const results = []
const check = (what, ok, detail = '') => {
  results.push(ok)
  console.log(ok ? '  ok  ' : '  FAIL', what, detail)
}
const headings = () => ev(`[...document.querySelectorAll('.bufferlist .category')].map((c) => ({ head: (c.querySelector('.category-head')?.textContent || '').replace('expand_more', '').replace('chevron_right', '').trim(), rows: [...c.querySelectorAll('[draggable=true]')].filter((r) => !r.classList.contains('category-head')).map((r) => r.textContent.trim()) }))`)
/** Holds a conversation (or a heading) over a heading and lets go. */
const drag = (from, to) =>
  ev(`(async () => {
    const row = [...document.querySelectorAll('.bufferlist [draggable=true]')].find((e) => e.textContent.replace(/[a-z_]+(?=[A-Z])/, '').trim().endsWith(${JSON.stringify(from)}) && e.textContent.trim().length < 40)
    const head = [...document.querySelectorAll('.bufferlist .category-head')].find((e) => e.textContent.includes(${JSON.stringify(to)}))
    if (!row || !head) return { row: !!row, head: !!head }
    const dt = new DataTransfer()
    const wait = () => new Promise((r) => setTimeout(r, 120))
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
    await wait()
    head.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }))
    head.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
    await wait()
    head.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
    await wait()
    return { dragged: true }
  })()`)
try {
  await openIrcChannel(page, { port: irc.address().port, nick: 'checker', channels: ['#ui'], waitFor: 'hello there' })
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  // A window that is not focused takes a field's focus away again as soon as it is given.
  await page.call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await ev(`(() => {
    const s = window.__mohoShots
    const st = s.state()
    const irc = st.accounts[0]
    const ircGroup = st.groups.find((g) => g.kind === 'account')
    const channel = st.buffers.find((b) => b.id.endsWith('|#ui'))
    const account = { ...irc, id: 'telegram:7', service: 'telegram', displayName: 'me', state: 'connected' }
    const group = { ...ircGroup, id: 'account:telegram:7', accountId: 'telegram:7', service: 'telegram', name: 'Telegram - me' }
    const chat = (name, id, category) => ({ ...channel, id: 'telegram:7|' + name, accountId: 'telegram:7', name, kind: 'dm', remoteId: id, groupId: group.id, category, position: 0, unread: 0, highlight: false, mentions: 0 })
    const buffers = [
      chat('Alice', '101', 'Direct Messages'), chat('Bob', '102', 'Direct Messages'), chat('Carol', '103', 'Direct Messages'),
      chat('HelperBot', '201', 'Bots'), chat('News', '-1001', 'Channels')
    ]
    window.__calls = []
    const store = s.store
    for (const name of ['fileTelegramChat', 'renameTelegramFolder', 'deleteTelegramFolder', 'reorderTelegramFolders']) {
      store[name] = (...a) => { window.__calls.push([name, ...a]) }
    }
    store.createTelegramFolder = async (...a) => { window.__calls.push(['createTelegramFolder', ...a]); return true }
    s.patch({
      accounts: [...st.accounts, account],
      groups: [...st.groups, group],
      buffers: [...st.buffers, ...buffers],
      telegramFolders: { 'telegram:7': [
        { id: 3, name: 'Work', members: ['101', '102'] },
        { id: 2, name: 'Bots', members: ['201'] }
      ] },
      activeGroupId: group.id, activeBufferId: buffers[0].id
    })
  })()`)
  await sleep(1200)
  await ev(`window.__mohoShots.patch({ telegramFolders: { 'telegram:7': [{ id: 3, name: 'Work', members: ['101', '102'] }, { id: 2, name: 'Bots', members: ['201'] }] } })`)
  await sleep(500)
  let h = await headings()
  console.log(JSON.stringify(h))
  check('the account page has a category for each folder, in Telegram’s order', h.findIndex((x) => x.head === 'Work') >= 0 && h.findIndex((x) => x.head === 'Work') < h.findIndex((x) => x.head === 'Bots'))
  check('conversations sit under the folder that holds them', h.find((x) => x.head === 'Work')?.rows.length === 2 && h.find((x) => x.head === 'Bots')?.rows.length === 1)
  await shot('telegram-folders.png')

  await drag('Alice', 'Bots')
  const filed = await ev(`window.__calls.filter((c) => c[0] === 'fileTelegramChat')`)
  check('dragging a conversation to another folder asks Telegram to move it there', JSON.stringify(filed) === JSON.stringify([['fileTelegramChat', 'telegram:7|Alice', 2]]), JSON.stringify(filed))
  h = await headings()
  check('and nothing moves here until Telegram says so', h.find((x) => x.head === 'Work')?.rows.length === 2)

  // Telegram says it did.
  await ev(`window.__mohoShots.patch({ telegramFolders: { 'telegram:7': [{ id: 3, name: 'Work', members: ['102'] }, { id: 2, name: 'Bots', members: ['201', '101'] }] } })`)
  await sleep(400)
  h = await headings()
  check('what Telegram says is what is drawn', h.find((x) => x.head === 'Work')?.rows.length === 1 && h.find((x) => x.head === 'Bots')?.rows.length === 2)

  // A folder added on another of the account's apps turns up.
  await ev(`window.__mohoShots.patch({ telegramFolders: { 'telegram:7': [{ id: 3, name: 'Work', members: ['102'] }, { id: 2, name: 'Bots', members: ['201', '101'] }, { id: 4, name: 'Family', members: ['103'] }] } })`)
  await sleep(400)
  h = await headings()
  check('a folder made on another device turns up as a category', h.some((x) => x.head === 'Family' && x.rows.length === 1))

  // The order, by dragging a heading.
  await ev(`(async () => {
    const heads = [...document.querySelectorAll('.bufferlist .category-head')]
    const from = heads.find((e) => e.textContent.includes('Family'))
    const to = heads.find((e) => e.textContent.includes('Work'))
    const dt = new DataTransfer()
    const wait = () => new Promise((r) => setTimeout(r, 120))
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
    await wait()
    to.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }))
    to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
    await wait()
    to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
  })()`)
  await sleep(400)
  const reordered = await ev(`window.__calls.filter((c) => c[0] === 'reorderTelegramFolders')`)
  check('dragging a heading puts the folders in that order on Telegram', reordered.length >= 1 && JSON.stringify(reordered.at(-1)) === JSON.stringify(['reorderTelegramFolders', 'telegram:7', [4, 3, 2]]), JSON.stringify(reordered))

  // A new category is only drawn until a conversation is put in it. (A click with a mouse takes focus off the message
  // box; these do not, and the menu would give it back to the box as it closed, taking it from the name field.)
  await ev(`document.activeElement?.blur()`)
  await ev(`(() => { const t = [...document.querySelectorAll('.bufferlist button')].find((b) => b.textContent.includes('Telegram - me')); t && t.click() })()`)
  await sleep(300)
  await ev(`(() => { const i = [...document.querySelectorAll('.context-menu button, .context-menu [role=menuitem]')].find((e) => e.textContent.includes('New category')); i && i.click() })()`)
  await sleep(100)
  h = await headings()
  const naming = await ev(`!!document.querySelector('.category-name-field')`)
  console.log('naming field right after:', naming, JSON.stringify(h.map((x) => x.head)))
  check('a new category is drawn where it was asked for, empty', naming || h.some((x) => x.head === 'New category' && x.rows.length === 0))
  check('and nothing has been asked of Telegram', !(await ev(`window.__calls.some((c) => c[0] === 'createTelegramFolder')`)))
  // Named by typing over the name it opened with.
  if (naming) {
    await ev(`(() => { const inp = document.querySelector('.category-name-field'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(inp, 'Raiders'); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })()`)
    await sleep(300)
  }
  h = await headings()
  console.log(JSON.stringify(h.map((x) => x.head)))
  await shot('telegram-folders-new.png')
  const pendingName = h.find((x) => x.head === 'Raiders') ? 'Raiders' : 'New category'
  await drag('Carol', pendingName)
  const made = await ev(`window.__calls.filter((c) => c[0] === 'createTelegramFolder')`)
  check('the first conversation put in it makes it a folder', made.length === 1 && made[0][1] === 'telegram:7|Carol' && made[0][2] === pendingName, JSON.stringify(made))

  // Rename and delete, from the heading's menu.
  const menu = async (head, label) => {
    await ev(`(() => { const e = [...document.querySelectorAll('.bufferlist .category-head')].find((x) => x.textContent.includes(${JSON.stringify(head)})); e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 })) })()`)
    await sleep(300)
    await ev(`(() => { const i = [...document.querySelectorAll('.context-menu button, .context-menu [role=menuitem]')].find((e) => e.textContent.includes(${JSON.stringify(label)})); i && i.click() })()`)
    await sleep(300)
  }
  await menu('Bots', 'Remove')
  check('removing a category deletes the folder on Telegram', JSON.stringify(await ev(`window.__calls.filter((c) => c[0] === 'deleteTelegramFolder')`)) === JSON.stringify([['deleteTelegramFolder', 'telegram:7', 2]]))
  await ev(`document.activeElement?.blur()`)
  // Renamed: typed over as soon as the field is there (a window that is not focused takes it away again).
  await ev(`(async () => {
    const e = [...document.querySelectorAll('.bufferlist .category-head')].find((x) => x.textContent.includes('Work'))
    e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }))
    await new Promise((r) => setTimeout(r, 200))
    const i = [...document.querySelectorAll('.context-menu button, .context-menu [role=menuitem]')].find((x) => x.textContent.includes('Rename'))
    i.click()
    await new Promise((r) => setTimeout(r, 30))
    const inp = document.querySelector('.category-name-field')
    if (!inp) return
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(inp, 'Job')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })()`)
  await sleep(300)
  const renamed = await ev(`window.__calls.filter((c) => c[0] === 'renameTelegramFolder')`)
  check('renaming one renames the folder on Telegram', renamed.some((c) => c[1] === 'telegram:7' && c[2] === 3 && c[3] === 'Job'), JSON.stringify(renamed))
} finally {
  await stop()
  irc.close()
  console.log(results.every(Boolean) ? 'ALL OK' : 'SOME FAILED')
  process.exitCode = results.every(Boolean) ? 0 : 1
}
