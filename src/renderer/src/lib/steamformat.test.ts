import { describe, expect, it } from 'vitest'
import { emojiPreview, formatMessage } from './format'
import { formatsFor, serialize, wrap, type BoxNode } from './composeFormat'

const text = (value: string): BoxNode => ({ nodeType: 3, nodeValue: value, nodeName: '#text', childNodes: [] })
const el = (nodeName: string, children: BoxNode[], dataset?: Record<string, string>): BoxNode => ({ nodeType: 1, nodeValue: null, nodeName, childNodes: children, dataset })
const emoticon = (name: string): BoxNode => el('IMG', [], { token: `[steam:emote:${name}]` })

describe('what Steam sends is drawn', () => {
  it('draws an emoticon by its name, as a picture, and a sticker larger', () => {
    const html = formatMessage('hi [steam:emote:steamhappy] and [steam:sticker:CatSurprise]')
    expect(html).toContain('economy/emoticon/steamhappy')
    expect(html).toContain('class="custom-emoji"')
    expect(html).toContain('economy/sticker/CatSurprise')
    expect(html).toContain('custom-emoji steam-sticker')
    expect(html).not.toContain('[steam:')
  })

  it('does not take other square brackets for pictures', () => {
    const html = formatMessage('[steam:emote:bad name] [steam:other:x] [steam:emote:]')
    expect(html).not.toContain('<img')
  })

  it('draws the formatting the daemon read into marks', () => {
    const html = formatMessage('**bold** and *italic* and [u]under[/u] and ~~struck~~ and ||secret|| and [the site](https://example.com)')
    expect(html).toContain('<b>bold</b>')
    expect(html).toContain('<i>italic</i>')
    expect(html).toMatch(/<u>under<\/u>/)
    expect(html).toMatch(/<(s|del|strike)>struck<\/(s|del|strike)>/)
    expect(html).toContain('spoiler')
    expect(html).toContain('href="https://example.com"')
  })

  it('previews an emoticon picked out of the picker', () => {
    expect(emojiPreview('[steam:emote:steamhappy]')?.label).toBe(':steamhappy:')
    expect(emojiPreview('[steam:emote:steamhappy]')?.src).toContain('economy/emoticon/steamhappy')
    expect(emojiPreview('[steam:emote:a b]')).toBeNull()
  })
})

describe('what is written for Steam', () => {
  it('offers no formatting, because Steam takes none', () => {
    expect(formatsFor('steam')).toEqual([])
    expect(wrap('steam', 'bold', 'x')).toBe('x')
  })

  it('escapes a bracket somebody typed, so it stays a bracket', () => {
    expect(serialize(el('DIV', [text('a [b]literal[/b] tag')]), 'steam')).toBe('a \\[b]literal\\[/b] tag')
    // Other services are not touched.
    expect(serialize(el('DIV', [text('a [b]x[/b]')]), 'discord')).toBe('a [b]x[/b]')
  })

  it('sends bold typed in the box as plain text, not as tags Steam would show literally', () => {
    expect(serialize(el('DIV', [text('hi '), el('B', [text('there [x]')])]), 'steam')).toBe('hi there \\[x]')
  })

  it('sends an emoticon as its name between colons, and only for Steam', () => {
    expect(serialize(el('DIV', [text('hello '), emoticon('steamhappy')]), 'steam')).toBe('hello :steamhappy:')
    expect(serialize(el('DIV', [emoticon('steamhappy')]), 'discord')).toBe('[steam:emote:steamhappy]')
  })
})
