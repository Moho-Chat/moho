import { describe, expect, it } from 'vitest'
import { emojiPreview, extractMedia, formatMessage, splitTrailingPunctuation, normalizeBBCode, isSteamUpload, markSpoilered, stripEmbeddedUrls, sourcePick, steamSameText } from './format'
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
  it('is drawn as what the message says it is, a video having no extension to say so', () => {
    const video = 'https://cdn.steamusercontent.com/ugc/9279387166147417773/0642C6E9889E1C2419DD7F85743538C67DD8CA36/'
    const items = extractMedia(`\n[steam:video:${video}]\n`)
    expect(items.map((m) => [m.url, m.kind])).toEqual([[video, 'video']])
    expect(stripEmbeddedUrls(`hi\n[steam:video:${video}]\n`, items)).toBe('hi')
    expect(formatMessage(`[steam:video:${video}]`)).toContain('cdn.steamusercontent.com')
    expect(formatMessage(`[steam:video:${video}]`)).not.toContain('steam:video')
  })
  it('is read from how the daemon first stored a video, too', () => {
    const video = 'https://cdn.steamusercontent.com/ugc/9279387166147417773/0642C6E9889E1C2419DD7F85743538C67DD8CA36/'
    const stored = `||\n${video}\n${video}[/video]||`
    const items = markSpoilered(extractMedia(normalizeBBCode(stored)), normalizeBBCode(stored))
    expect(items.map((m) => [m.kind, m.spoiler])).toEqual([['video', true]])
  })
  it('is hidden when Steam sent it as a spoiler, and leaves no empty bars behind', () => {
    const body = `||\n[steam:image:${url}]\n||`
    const items = markSpoilered(extractMedia(body), body)
    expect(items.map((m) => m.spoiler)).toEqual([true])
    expect(stripEmbeddedUrls(body, items)).toBe('')
    const plain = `${url}`
    expect(markSpoilered(extractMedia(plain), plain).map((m) => m.spoiler)).toEqual([undefined])
  })
  it('is read from the tag as it was stored before the daemon read it', () => {
    const stored = `[img src=${url} thumbnail_src=${url} srcset="" width=479 height=450]${url}`
    expect(normalizeBBCode(stored).trim()).toBe(`[steam:image:${url}]`)
    expect(extractMedia(normalizeBBCode(stored)).map((m) => [m.url, m.kind])).toEqual([[url, 'image']])
  })
  it('hides a picture a Sneedchat or Discord message spoilers, by the same rule', () => {
    const png = 'https://example.com/a.png'
    const sneed = normalizeBBCode(`[spoiler][img]${png}[/img][/spoiler]`)
    expect(markSpoilered(extractMedia(sneed), sneed).map((m) => m.spoiler)).toEqual([true])
    const discord = `look ||${png}||`
    expect(markSpoilered(extractMedia(discord), discord).map((m) => m.spoiler)).toEqual([true])
    const open = `look ${png}`
    expect(markSpoilered(extractMedia(open), open).map((m) => m.spoiler)).toEqual([undefined])
  })
})

describe('a Steam sticker is named by words', () => {
  it('draws one whose name has spaces in it, larger, from an address that takes them', () => {
    const html = formatMessage('[steam:sticker:Nyan GLaDOS]')
    expect(html).toContain('economy/sticker/Nyan%20GLaDOS')
    expect(html).toContain('steam-sticker')
    expect(html).not.toContain('[steam:')
    expect(emojiPreview('[steam:sticker:Keyboard Headcrab]')?.label).toBe(':Keyboard Headcrab:')
  })
  it('keeps an emoticon one word', () => {
    expect(emojiPreview('[steam:emote:a b]')).toBeNull()
    expect(formatMessage('[steam:emote:a b]')).not.toContain('<img')
  })
  it('is held as a reaction under that name', () => {
    expect(reactionLabel('[steam:sticker:Nyan GLaDOS]')).toBe(':Nyan GLaDOS:')
  })
})

describe('a link in a sentence', () => {
  it('does not take the sentence\'s punctuation', () => {
    expect(splitTrailingPunctuation('https://x.test/a,')).toEqual(['https://x.test/a', ','])
    expect(splitTrailingPunctuation('https://x.test/a.')).toEqual(['https://x.test/a', '.'])
    expect(splitTrailingPunctuation('https://x.test/a?!')).toEqual(['https://x.test/a', '?!'])
    expect(splitTrailingPunctuation('https://x.test/a)')).toEqual(['https://x.test/a', ')'])
    expect(splitTrailingPunctuation('https://x.test/Foo_(bar)')).toEqual(['https://x.test/Foo_(bar)', ''])
    expect(splitTrailingPunctuation('https://x.test/?a=1&amp;b=2')).toEqual(['https://x.test/?a=1&amp;b=2', ''])
    expect(splitTrailingPunctuation('https://x.test/a?b=1')).toEqual(['https://x.test/a?b=1', ''])
  })
  it('is drawn with the punctuation outside it', () => {
    const html = formatMessage('read https://x.test/a, then https://x.test/b.')
    expect(html).toContain('<a href="https://x.test/a">https://x.test/a</a>,')
    expect(html).toContain('<a href="https://x.test/b">https://x.test/b</a>.')
  })
})

describe('the message just sent, when Steam made something of its link', () => {
  it('is the one that came back as a picture, a video or a card', () => {
    const png = 'https://upload.wikimedia.org/a/b.png'
    expect(steamSameText(png, `[steam:image:${png}]`)).toBe(true)
    expect(steamSameText('https://x.test/v', '[steam:video:https://x.test/v]')).toBe(true)
    expect(steamSameText('x.salastil.com', '[x.salastil.com](http://x.salastil.com)')).toBe(true)
    expect(steamSameText('https://x.test/p', 'https://x.test/p')).toBe(true)
    expect(steamSameText(png, '[steam:image:https://other.test/c.png]')).toBe(false)
  })
})

