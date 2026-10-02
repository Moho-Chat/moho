import { describe, expect, it } from 'vitest'
import {
  buildSmilieIndex,
  discordEmojiUrl,
  embedColor,
  emojiPreview,
  escapeHtml,
  extractCodeBlocks,
  extractMedia,
  extractQuoteBlocks,
  formatMessage,
  hostnameOf,
  ircFormat,
  normalizeBBCode,
  stripCodeBlocks,
  stripEmbeddedUrls,
  stripQuoteBlocks,
  thumbnailLinks,
  youtubeId
} from './format'

describe('emoji and emotes', () => {
  it('asks Discord for the animated WebP, whatever the emoji claims', () => {
    expect(discordEmojiUrl('123')).toBe('https://cdn.discordapp.com/emojis/123.webp?size=44&animated=true')
  })

  it('shows a stand-in as the picture it stands for', () => {
    expect(emojiPreview('<:lettyCrazy:1413156421880647762>')).toEqual({
      src: discordEmojiUrl('1413156421880647762'),
      label: ':lettyCrazy:'
    })
    expect(emojiPreview('[emote:39261:catJAM]')?.label).toBe(':catJAM:')
    // A Unicode emoji is its own picture.
    expect(emojiPreview('😂')).toBeNull()
  })

  it('draws Discord custom emoji and Kick emotes inline', () => {
    const html = formatMessage('hi <a:dance:42> and [emote:7:wave]')
    expect(html).toContain(`<img src="${discordEmojiUrl('42', 48)}" class="custom-emoji" alt=":dance:">`)
    expect(html).toContain('alt=":wave:"')
    expect(html).toContain('files.kick.com/emotes/7/fullsize')
  })

  it('replaces the longest Sneedchat shortcode first', () => {
    const index = buildSmilieIndex([
      { aliases: [':lol:'], label: 'lol', url: 'a.png' } as never,
      { aliases: [':lolol:'], label: 'lolol', url: 'b.png' } as never
    ])
    const html = formatMessage('x :lolol: y', { isSneedchat: true, smilies: index })
    expect(html).toContain('src="b.png"')
    expect(html).not.toContain('src="a.png"')
  })
})

describe('IRC formatting codes', () => {
  it('strips them for every protocol that does not use them', () => {
    expect(ircFormat('\u0002bold\u0002 \u000304red\u0003 plain', 'strip')).toBe('bold red plain')
    expect(ircFormat('no codes here', 'strip')).toBe('no codes here')
  })

  it('renders bold and colour, and closes what it opens', () => {
    const html = ircFormat('\u0002b\u000f \u000304,01x\u0003', 'render')
    expect(html).toContain('font-weight:600')
    expect(html).toContain('color:#ff0000')
    expect(html).toContain('background:#000000')
    expect(html.match(/<span/g)?.length).toBe(html.match(/<\/span>/g)?.length)
  })

  it('strips them before formatting even when not rendering them', () => {
    expect(formatMessage('https://ex\u0002ample.com')).toContain('href="https://example.com"')
  })
})

describe('BBCode', () => {
  it('unwraps pictures to bare URLs a link scan can find', () => {
    expect(normalizeBBCode('[img]https://a/x.png[/img][img]https://a/y.png[/img]').split('\n').filter(Boolean)).toEqual([
      'https://a/x.png',
      'https://a/y.png'
    ])
  })

  it('turns quotes, spoilers, code and line breaks into the shared conventions', () => {
    expect(normalizeBBCode('a[br]b')).toBe('a\nb')
    expect(normalizeBBCode('[spoiler]boo[/spoiler]')).toBe('||boo||')
    expect(normalizeBBCode('[quote]one\ntwo[/quote]')).toBe('\n> one\n> two\n')
    expect(normalizeBBCode('[php]x[/php]')).toBe('```x```')
    expect(normalizeBBCode('[code]x[/code]')).toBe('`x`')
  })

  it('pairs a thumbnail with the different page it links to', () => {
    expect(thumbnailLinks('[url=https://host/page][img]https://host/t.jpg[/img][/url]')).toEqual({
      'https://host/t.jpg': 'https://host/page'
    })
    expect(thumbnailLinks('[url=https://host/t.jpg][img]https://host/t.jpg[/img][/url]')).toEqual({})
  })

  it('formats greentext colour and strips tags it does not know', () => {
    const html = formatMessage('[color=#72ff72]>implying[/color] [blink]x[/blink]', { isSneedchat: true })
    expect(html).toContain('<span style="color:#72ff72">&gt;implying</span>'.replace('&gt;', '>'))
    expect(html).not.toContain('[blink]')
  })
})

describe('formatMessage', () => {
  it('numbers spoilers in order and reveals by number', () => {
    const html = formatMessage('||one|| ||two||', { revealedSpoilers: { 1: true } })
    expect(html).toContain('<a href="spoiler:0" class="spoiler">one</a>')
    expect(html).toContain('<span class="spoiler revealed">two</span>')
  })

  it('keeps inline code literal and escaped', () => {
    expect(formatMessage('`**not bold** <b>`')).toContain('&lt;b&gt;')
    expect(formatMessage('`**not bold**`')).not.toContain('<b>')
  })

  it('links Discord channel mentions it knows, and says so when it does not', () => {
    const channels = { '55': { bufferId: 'discord:1|g/#general', name: '#general' } }
    expect(formatMessage('see <#55>', { channels })).toContain(
      `<a href="channel:${encodeURIComponent('discord:1|g/#general')}" class="channel-mention">#general</a>`
    )
    expect(formatMessage('see <#99>')).toContain('#unknown-channel')
  })

  it('turns markdown and bare links into markup', () => {
    const html = formatMessage('**b** *i* ~~s~~ https://example.com/x')
    expect(html).toContain('<b>b</b>')
    expect(html).toContain('<i>i</i>')
    expect(html).toContain('<s>s</s>')
    expect(html).toContain('<a href="https://example.com/x">https://example.com/x</a>')
  })

  it('does not italicise snake_case in the middle of a word', () => {
    expect(formatMessage('a snake_case_name here')).not.toContain('<i>')
  })

  it('escapes what it is asked to', () => {
    expect(escapeHtml('<a & b>')).toBe('&lt;a &amp; b&gt;')
  })
})

describe('media in a message', () => {
  it('finds YouTube in every form a link arrives in', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ'
    ]) {
      expect(youtubeId(url), url).toBe('dQw4w9WgXcQ')
    }
    expect(youtubeId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull()
  })

  it('classifies pictures, video and YouTube, once each', () => {
    const items = extractMedia(
      'https://a.com/x.png?w=1 https://a.com/v.webm https://youtu.be/dQw4w9WgXcQ https://www.youtube.com/watch?v=dQw4w9WgXcQ https://a.com/x.png?w=1.'
    )
    expect(items.map((i) => i.kind)).toEqual(['image', 'video', 'youtube'])
  })

  it('asks for a sniff only for links it cannot classify, and only when allowed', () => {
    const asked: string[] = []
    extractMedia('https://a.com/page', { contentSniffing: true, onNeedSniff: (u) => asked.push(u) })
    extractMedia('https://a.com/other', { onNeedSniff: (u) => asked.push(u) })
    expect(asked).toEqual(['https://a.com/page'])
  })

  it('gives a thumbnail the full-size copy it was linked to', () => {
    const items = extractMedia('https://h/t.jpg', { thumbnails: { 'https://h/t.jpg': 'https://h/full.jpg' } })
    expect(items).toEqual([{ url: 'https://h/t.jpg', kind: 'image', full: 'https://h/full.jpg' }])
  })

  it('takes embedded links out of the text, YouTube by video rather than by URL', () => {
    const text = 'look https://youtu.be/dQw4w9WgXcQ\nand https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    const items = extractMedia(text)
    expect(stripEmbeddedUrls(text, items)).toBe('look\nand')
  })

  it('reads a hostname without its port, in lower case', () => {
    expect(hostnameOf('https://I.DDOS.LGBT:8443/x')).toBe('i.ddos.lgbt')
    expect(hostnameOf('not a url')).toBe('')
  })
})

describe('blocks', () => {
  it('pulls fenced code out, language line and all', () => {
    const text = 'before\n```rust\nfn main() {}\n```\nafter'
    expect(extractCodeBlocks(text)).toEqual(['fn main() {}'])
    expect(stripCodeBlocks(text)).toBe('before\n\nafter')
  })

  it('groups consecutive quote lines into one quote', () => {
    const text = '> a\n> b\nmiddle\n> c'
    expect(extractQuoteBlocks(text)).toEqual(['a\nb', 'c'])
    expect(stripQuoteBlocks(text)).toBe('middle')
  })

  it('writes Discord embed colours as hex', () => {
    expect(embedColor(0x5865f2)).toBe('#5865f2')
    expect(embedColor(255)).toBe('#0000ff')
    expect(embedColor(undefined)).toBeUndefined()
  })
})
