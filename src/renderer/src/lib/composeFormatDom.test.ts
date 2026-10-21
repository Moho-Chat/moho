// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { textNodes, transformFormat } from './composeFormatDom'
import type { FormatKind } from './composeFormat'

/** What the box says, with the formats marked as they would be on Discord. */
function marked(root: Node): string {
  const mark: Record<string, string> = { bold: '**', italic: '_', underline: '__', strike: '~~', code: '`', spoiler: '||', quote: '> ' }
  return Array.from(root.childNodes)
    .map((n) => {
      if (n.nodeType === 3) return n.nodeValue
      if (n instanceof HTMLElement && n.dataset.fmt === 'color') return `{${n.dataset.color}:${marked(n)}}`
      if (n instanceof HTMLElement && n.dataset.fmt) return `${mark[n.dataset.fmt]}${marked(n)}${mark[n.dataset.fmt]}`
      return marked(n)
    })
    .join('')
}

/** A box holding `html`, with `needle` selected in its text. */
function box(html: string, needle: string): { root: HTMLElement; range: Range } {
  const root = document.createElement('div')
  root.innerHTML = html
  const nodes = textNodes(root)
  const all = nodes.map((n) => n.nodeValue).join('')
  const at = all.indexOf(needle)
  expect(at).toBeGreaterThanOrEqual(0)
  const locate = (offset: number, preferEnd: boolean): [Text, number] => {
    let seen = 0
    for (const n of nodes) {
      const len = n.nodeValue!.length
      if (preferEnd ? offset <= seen + len : offset < seen + len) return [n, offset - seen]
      seen += len
    }
    throw new Error('outside')
  }
  const range = document.createRange()
  range.setStart(...locate(at, false))
  range.setEnd(...locate(at + needle.length, true))
  return { root, range }
}

function run(html: string, needle: string, kind: FormatKind, colour?: string): { text: string; selected: string; done: boolean } {
  const { root, range } = box(html, needle)
  const done = transformFormat(root, range, kind, colour)
  return { text: marked(root), selected: range.toString(), done }
}

const B = (s: string): string => `<span data-fmt="bold">${s}</span>`

describe('putting a format on', () => {
  it('wraps the selection and leaves it selected', () => {
    expect(run('one two three', 'two', 'bold')).toEqual({ text: 'one **two** three', selected: 'two', done: true })
  })

  it('makes a selection that is partly bold all bold, once', () => {
    const r = run(`one ${B('two')} three four`, 'one two thr', 'bold')
    expect(r.text).toBe('**one two thr**ee four')
    expect(r.selected).toBe('one two thr')
  })

  it('joins a run that ends where the new one begins', () => {
    expect(run(`${B('ab')}cd`, 'cd', 'bold').text).toBe('**abcd**')
    expect(run(`ab${B('cd')}`, 'ab', 'bold').text).toBe('**abcd**')
  })

  it('stacks on another format without breaking it', () => {
    const r = run('one <span data-fmt="italic">two three</span> four', 'three four', 'bold')
    expect(r.text).toBe('one _two _**_three_ four**')
  })

  it('does nothing with nothing selected', () => {
    const { root, range } = box('one two', 'two')
    range.collapse(true)
    expect(transformFormat(root, range, 'bold')).toBe(false)
    expect(marked(root)).toBe('one two')
  })
})

describe('taking a format off', () => {
  it('takes it off a whole run', () => {
    expect(run(`one ${B('two')} three`, 'two', 'bold')).toEqual({ text: 'one two three', selected: 'two', done: true })
  })

  it('takes it off part of a run and leaves the rest of the run bold', () => {
    const r = run(`one ${B('two three')} four`, 'wo th', 'bold')
    expect(r.text).toBe('one **t**wo th**ree** four')
    expect(r.selected).toBe('wo th')
  })

  it('takes it off the end of a run', () => {
    expect(run(`one ${B('two three')}`, 'three', 'bold').text).toBe('one **two **three')
  })

  it('takes it off from two runs side by side when all of the selection has it', () => {
    expect(run(`${B('one')}${B('two')}`, 'netw', 'bold').text).toBe('**o**ne' + 'tw' + '**o**')
  })

  it('does not take it off a selection that reaches a space which is not bold: that is put on instead', () => {
    expect(run(`${B('one')} ${B('two')}`, 'e t', 'bold').text).toBe('**one two**')
  })

  it('only the format asked for', () => {
    const r = run('<span data-fmt="bold"><span data-fmt="italic">two</span></span>', 'two', 'bold')
    expect(r.text).toBe('_two_')
  })
})

describe('colour', () => {
  it('puts a colour on, and a different one replaces it', () => {
    const on = box('one two', 'two')
    expect(transformFormat(on.root, on.range, 'color', '#ff0000')).toBe(true)
    expect(marked(on.root)).toBe('one {#ff0000:two}')
    expect(transformFormat(on.root, on.range, 'color', '#00ff00')).toBe(true)
    expect(marked(on.root)).toBe('one {#00ff00:two}')
    expect(transformFormat(on.root, on.range, 'color')).toBe(true)
    expect(marked(on.root)).toBe('one two')
  })

  it('takes no colour that is not a plain hex value', () => {
    expect(run('one two', 'two', 'color', 'red; background:url(x)').done).toBe(false)
  })

  it('has nothing to take off when there is no colour', () => {
    expect(run('one two', 'two', 'color').done).toBe(false)
  })
})
