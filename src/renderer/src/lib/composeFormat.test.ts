import { describe, expect, it } from 'vitest'
import { formatsFor, serialize, wrap, type BoxNode } from './composeFormat'

const text = (value: string): BoxNode => ({ nodeType: 3, nodeValue: value, nodeName: '#text', childNodes: [] })
const el = (name: string, children: BoxNode[], dataset: Record<string, string> = {}): BoxNode => ({
  nodeType: 1,
  nodeValue: null,
  nodeName: name,
  childNodes: children,
  dataset
})
const fmt = (kind: string, children: BoxNode[], extra: Record<string, string> = {}): BoxNode =>
  el('SPAN', children, { fmt: kind, ...extra })
const box = (...children: BoxNode[]): BoxNode => el('DIV', children)

describe('what each service can say', () => {
  it('offers only what the protocol carries', () => {
    expect(formatsFor('discord')).toContain('spoiler')
    expect(formatsFor('matrix')).not.toContain('underline')
    expect(formatsFor('irc')).toContain('color')
    expect(formatsFor('irc')).not.toContain('quote')
    expect(formatsFor('kick')).toEqual([])
    expect(formatsFor(undefined)).toEqual([])
  })
})

describe('serialising the box', () => {
  const sample = box(text('a '), fmt('bold', [text('b')]), text(' '), fmt('italic', [text('i')]))

  it('writes Markdown for Discord and Matrix', () => {
    expect(serialize(sample, 'discord')).toBe('a **b** *i*')
    expect(serialize(sample, 'matrix')).toBe('a **b** *i*')
  })
  it('writes BBCode for Sneedchat', () => {
    expect(serialize(sample, 'sneedchat')).toBe('a [b]b[/b] [i]i[/i]')
  })
  it('writes control characters for IRC', () => {
    expect(serialize(sample, 'irc')).toBe('a \u0002b\u0002 \u001di\u001d')
  })
  it('writes nothing for a service with no formatting', () => {
    expect(serialize(sample, 'kick')).toBe('a b i')
  })
  it('drops a format the service lacks and keeps the words', () => {
    const b = box(fmt('underline', [text('u')]))
    expect(serialize(b, 'matrix')).toBe('u')
    expect(serialize(b, 'discord')).toBe('__u__')
  })
  it('says bold once however deeply it is nested', () => {
    const b = box(fmt('bold', [text('x '), fmt('bold', [text('y')])]))
    expect(serialize(b, 'discord')).toBe('**x y**')
  })
  it('nests different formats', () => {
    const b = box(fmt('bold', [fmt('italic', [text('x')])]))
    expect(serialize(b, 'discord')).toBe('***x***')
    expect(serialize(b, 'sneedchat')).toBe('[b][i]x[/i][/b]')
  })
  it('understands the browser\'s own bold and italic', () => {
    expect(serialize(box(el('B', [text('x')]), el('I', [text('y')])), 'discord')).toBe('**x***y*')
  })
  it('leaves an emoji as its token and a break as a newline', () => {
    const img = el('IMG', [], { token: ':a:' })
    expect(serialize(box(text('x'), img, el('BR', []), text('y')), 'discord')).toBe('x:a:\ny')
  })
  it('keeps whitespace outside the markers, where Markdown wants it', () => {
    expect(serialize(box(fmt('bold', [text(' hi ')])), 'discord')).toBe(' **hi** ')
  })
  it('does not format nothing', () => {
    expect(serialize(box(fmt('bold', [text('  ')])), 'discord')).toBe('  ')
  })
})

describe('markup details', () => {
  it('fences code with more backticks than it holds', () => {
    expect(wrap('discord', 'code', 'a`b')).toBe('``a`b``')
    expect(wrap('discord', 'code', '`a')).toBe('`` `a ``')
    expect(wrap('discord', 'code', 'plain')).toBe('`plain`')
  })
  it('quotes every line, on a line of its own', () => {
    expect(wrap('discord', 'quote', 'one\ntwo')).toBe('\n> one\n> two\n')
    expect(wrap('matrix', 'quote', 'x')).toBe('x')
    expect(wrap('irc', 'quote', 'x')).toBe('x')
  })
  it('hides an IRC spoiler by colouring it into its background', () => {
    expect(wrap('irc', 'spoiler', 'secret')).toBe('\u000301,01secret\u0003')
  })
  it('picks the nearest of IRC\'s sixteen colours, as two digits', () => {
    expect(wrap('irc', 'color', 'hi', '#ff0000')).toBe('\u000304hi\u0003')
    expect(wrap('irc', 'color', 'hi', '#fe0101')).toBe('\u000304hi\u0003')
  })
  it('keeps a digit after a colour from being read as part of it', () => {
    expect(wrap('irc', 'color', '5 apples', '#ff0000')).toBe('\u000304\u0002\u00025 apples\u0003')
  })
  it('gives Sneedchat the colour as written', () => {
    expect(wrap('sneedchat', 'color', 'g', '#00fc00')).toBe('[color=#00fc00]g[/color]')
  })
})
