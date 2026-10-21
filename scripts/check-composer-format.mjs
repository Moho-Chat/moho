#!/usr/bin/env node
/**
 * Formatting in the message box, in a scratch moho with injected state (nothing is contacted): a format applied
 * to a selection can be taken off again - by the keyboard shortcut or the strip's button, over the whole run,
 * over part of it, or over a selection reaching past it - and each step can be undone with the box's own undo.
 *
 *   node scripts/check-composer-format.mjs
 */
import { launchApp, sleep } from './lib/harness.mjs'

const { page, stop } = await launchApp({ env: { MOHO_UI_SHOTS: '1' } })
const ev = (code) => page.evaluate(code)
const results = []
const check = (what, ok, detail = '') => {
  results.push(ok)
  console.log(ok ? '  ok  ' : '  FAIL', what, ok ? '' : detail)
}
const BOX = '.composer-input'
const html = () => ev(`document.querySelector(${JSON.stringify(BOX)}).innerHTML.replace(/ data-[a-z-]+="[^"]*"/g, (m) => m.startsWith(' data-fmt') ? m : '')`)
/** The text the box would send, with the markers of what is bold, italic, and so on in it. */
const marked = () =>
  ev(`(() => {
    const mark = { bold: '**', italic: '_', underline: '__', strike: '~~', code: '\`', spoiler: '||', quote: '> ' }
    const walk = (n) => n.nodeType === 3 ? n.nodeValue : n instanceof HTMLElement && n.dataset.fmt ? (mark[n.dataset.fmt] ?? '') + [...n.childNodes].map(walk).join('') + (n.dataset.fmt === 'quote' ? '' : mark[n.dataset.fmt] ?? '') : [...n.childNodes].map(walk).join('')
    return walk(document.querySelector(${JSON.stringify(BOX)}))
  })()`)
const type = async (text) => {
  await ev(`(() => { const b = document.querySelector(${JSON.stringify(BOX)}); b.focus(); b.innerHTML = '' })()`)
  await page.call('Input.insertText', { text })
}
const select = (needle, nth = 0) =>
  ev(`(() => {
    const box = document.querySelector(${JSON.stringify(BOX)})
    const text = []
    const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT)
    for (let n; (n = w.nextNode()); ) text.push(n)
    const all = text.map((t) => t.nodeValue).join('')
    let at = -1
    for (let i = 0; i <= ${nth}; i++) at = all.indexOf(${JSON.stringify(needle)}, at + 1)
    if (at < 0) return false
    const locate = (offset) => { let seen = 0; for (const t of text) { if (offset <= seen + t.nodeValue.length) return [t, offset - seen]; seen += t.nodeValue.length } }
    const [a, ao] = locate(at)
    const [b, bo] = locate(at + ${JSON.stringify(needle)}.length)
    const r = document.createRange()
    r.setStart(a, ao); r.setEnd(b, bo)
    const s = getSelection(); s.removeAllRanges(); s.addRange(r)
    box.focus()
    return true
  })()`)
const key = (k, { ctrl = false, commands } = {}) =>
  page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0), modifiers: ctrl ? 2 : 0, commands })
const bold = () => key('b', { ctrl: true })
const undo = () => key('z', { ctrl: true, commands: ['undo'] })
const redo = () => key('z', { ctrl: true, commands: ['redo'] })
const strip = async (title) => {
  await sleep(150)
  return ev(`(() => { const b = [...document.querySelectorAll('.format-bar button')].find((x) => x.title === ${JSON.stringify(title)}); if (!b) return false; b.click(); return true })()`)
}

try {
  await sleep(2500)
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await ev(`(() => {
    const s = window.__mohoShots.store
    const acct = { id: 'discord:me', service: 'discord', name: 'me', host: '', port: 0, state: 'connected', hasPassword: true, nick: 'me' }
    const buf = { id: 'discord:me|chat', accountId: 'discord:me', kind: 'channel', name: 'chat', lastActivityTs: 5, category: 'Channels', groupId: 'account:discord:me' }
    s.set({ accounts: [acct], groups: [{ id: 'account:discord:me', accountId: 'discord:me', service: 'discord', kind: 'account', name: 'me', position: 0 }], buffers: [buf], messagesByBuffer: { 'discord:me|chat': [] }, activeBufferId: 'discord:me|chat' })
    s.selectGroup('account:discord:me')
  })()`)
  await sleep(1200)

  console.log('Applying and taking off')
  await type('one two three four')
  await select('two')
  await bold()
  check('bold goes on', (await marked()) === 'one **two** three four', await marked())
  await bold()
  check('the same key again takes it off', (await marked()) === 'one two three four', await marked())
  await bold()
  check('and again puts it back', (await marked()) === 'one **two** three four', await marked())

  console.log('Undo')
  await undo()
  check('undo takes the bold back off', (await marked()) === 'one two three four', await marked())
  await redo()
  check('redo puts it on again', (await marked()) === 'one **two** three four', await marked())
  check('redo leaves the word selected, not the whole message', (await ev(`String(getSelection())`)) === 'two', await ev(`String(getSelection())`))
  await bold()
  await undo()
  check('undo puts it back after it was taken off', (await marked()) === 'one **two** three four', await marked())
  check('and leaves the word selected', (await ev(`String(getSelection())`)) === 'two', await ev(`String(getSelection())`))

  console.log('Undo leaves a selection that is safe to type over')
  await type('one two three four')
  await select('two')
  await bold()
  await undo()
  check('after undo the word is selected, not the whole message', (await ev(`String(getSelection())`)) === 'two', await ev(`String(getSelection())`))

  console.log('The ends of the box')
  await type('one two')
  await select('one')
  await bold()
  check('the first word goes bold', (await marked()) === '**one** two', await marked())
  await bold()
  check('and comes off', (await marked()) === 'one two', await marked())
  await select('two')
  await bold()
  check('the last word goes bold', (await marked()) === 'one **two**', await marked())
  await bold()
  check('and comes off', (await marked()) === 'one two', await marked())

  console.log('Other formats')
  await type('one two three')
  await select('two')
  await key('i', { ctrl: true })
  check('italic goes on', (await marked()) === 'one _two_ three', await marked())
  await select('one two thr')
  await bold()
  check('bold over italic keeps both', (await marked()) === '**one _two_ thr**ee', await marked())
  await key('i', { ctrl: true })
  check('italic over text that is only partly italic makes all of it italic', (await marked()) === '**_one two thr_**ee', await marked())
  await key('i', { ctrl: true })
  check('and again takes italic off all of it, leaving the bold', (await marked()) === '**one two thr**ee', await marked())

  console.log('Lines')
  await type('first line')
  await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 8 })
  await page.call('Input.insertText', { text: 'second line' })
  if (!(await select('line\nsecond'))) await select('linesecond')
  await bold()
  const lines = await ev(`document.querySelector(${JSON.stringify(BOX)}).innerHTML`)
  check('a selection over two lines is bold, and the break is still there', /data-fmt="bold"/.test(lines) && (/<br/.test(lines) || /\n/.test(lines)) && (await marked()).replace(/\n/g, '').includes('**'), lines)
  await bold()
  check('and comes off whole', !/data-fmt/.test(await html()), await html())

  console.log('Part of a run')
  await type('one two three four')
  await select('two three')
  await bold()
  await select('wo th')
  await bold()
  check('part of a run is taken off, the rest stays', (await marked()) === 'one **t**wo th**ree** four', await marked())

  console.log('Reaching past a run')
  await type('one two three four')
  await select('two')
  await bold()
  await select('one two thr')
  await bold()
  check('a selection partly bold is made all bold, not doubled', (await marked()) === '**one two thr**ee four', await marked())
  await bold()
  check('and the next press takes it all off', (await marked()) === 'one two three four', await marked())

  console.log('The strip')
  await type('one two three four')
  await select('three')
  await sleep(300)
  check('the strip offers bold', await strip('Bold'))
  check('and it goes on', (await marked()) === 'one two **three** four', await marked())
  await sleep(300)
  check('the strip button again takes it off', (await strip('Bold')) && (await marked()) === 'one two three four', await marked())
  await undo()
  check('and undo puts it back', (await marked()) === 'one two **three** four', await marked())
} catch (e) {
  console.log('  FAIL', e.message)
  results.push(false)
} finally {
  await stop()
}
process.exit(results.every(Boolean) ? 0 : 1)
