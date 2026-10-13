import { describe, expect, it } from 'vitest'
import { emojiPreview, extractMedia, formatMessage, normalizeBBCode, isSteamUpload, markSpoilered, stripEmbeddedUrls, sourcePick, steamSameText } from './format'
import { formatsFor, serialize, wrap, type BoxNode } from './composeFormat'
import { reactionLabel } from './reactions'

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

describe('a reaction with a Steam emoticon', () => {
  it('is named by the emoticon', () => {
    expect(reactionLabel('[steam:emote:steamhappy]')).toBe(':steamhappy:')
    expect(reactionLabel('[steam:sticker:CatSurprise]')).toBe(':CatSurprise:')
    expect(reactionLabel('[steam:emote:a b]')).toBe('[steam:emote:a b]')
  })
})

describe('picking a Steam emoticon from the picker', () => {
  it('sends its token, which the box draws and sends as the colon form', () => {
    const entry = { id: 'steam:steambored', name: 'steambored', url: 'https://community.fastly.steamstatic.com/economy/emoticon/steambored', animated: false, locked: false }
    const token = sourcePick('steam', entry)
    expect(token).toBe('[steam:emote:steambored]')
    expect(emojiPreview(token)?.src).toContain('economy/emoticon/steambored')
    expect(serialize(el('DIV', [text('hi '), el('IMG', [], { token })]), 'steam')).toBe('hi :steambored:')
    // Sneedchat's id is its shortcode, and stays that.
    expect(sourcePick('sneedchat', { ...entry, id: ':lol:' })).toBe(':lol:')
  })
})

describe('a Steam message is the one just sent', () => {
  it('matches what was typed to what Steam logged, emoticons and brackets included', () => {
    expect(steamSameText('hi', 'hi')).toBe(true)
    expect(steamSameText(':steambored:', '[steam:emote:steambored]')).toBe(true)
    expect(steamSameText('a :steamhappy: b :steamsad:', 'a [steam:emote:steamhappy] b [steam:emote:steamsad]')).toBe(true)
    expect(steamSameText('not \\[b]bold', 'not [\u200bb]bold')).toBe(true)
    expect(steamSameText(':steambored:', '[steam:emote:steamhappy]')).toBe(false)
    expect(steamSameText('hello', 'hello there')).toBe(false)
  })
})

describe('a picture sent through Steam', () => {
  const url = 'https://images.steamusercontent.com/ugc/1269778906054997137/522C3130A7C6AE1FC52CB49820609316A34ECD01/'
  it('is known by where Steam keeps it, since its address has no extension', () => {
    expect(isSteamUpload(url)).toBe(true)
    expect(isSteamUpload('https://example.com/ugc/1/2/')).toBe(false)
    expect(isSteamUpload('https://images.steamusercontent.com/other/1')).toBe(false)
  })
  it('is drawn as a picture', () => {
    expect(extractMedia(`\n${url}\n`).map((m) => [m.url, m.kind])).toEqual([[url, 'image']])
  })
  it('is hidden when Steam sent it as a spoiler, and leaves no empty bars behind', () => {
    const body = `||\n${url}\n||`
    const items = markSpoilered(extractMedia(body), body)
    expect(items.map((m) => m.spoiler)).toEqual([true])
    expect(stripEmbeddedUrls(body, items)).toBe('')
    const plain = `${url}`
    expect(markSpoilered(extractMedia(plain), plain).map((m) => m.spoiler)).toEqual([undefined])
  })
  it('is read from the tag as it was stored before the daemon read it', () => {
    const stored = `[img src=${url} thumbnail_src=${url} srcset="" width=479 height=450]${url}`
    expect(normalizeBBCode(stored).trim()).toBe(url)
    expect(extractMedia(normalizeBBCode(stored)).map((m) => m.url)).toEqual([url])
  })
})
