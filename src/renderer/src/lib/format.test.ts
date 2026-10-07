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

  it('renders strikethrough and monospace, which this client also sends', () => {
    const html = ircFormat('\u001ewrong\u001e \u0011code\u0011', 'render')
    expect(html).toContain('text-decoration:line-through')
    expect(html).toContain('monospace')
    expect(ircFormat('\u001ea\u001e\u0011b\u0011', 'strip')).toBe('ab')
  })

  it('strips them before formatting even when not rendering them', () => {
    expect(formatMessage('https://ex\u0002ample.com')).toContain('href="https://example.com"')
  })
})

describe('BBCode', () => {
  it('keeps back-to-back picture links apart', () => {
    const body =
      '[url=https://i.x/u/a.webp][img]https://i.x/u/a.webp[/img][/url][url=https://i.x/u/b.webp][img]https://i.x/u/b.webp[/img][/url]\ntext'
    const items = extractMedia(normalizeBBCode(body), {}).map((i) => i.url)
    expect(items).toEqual(['https://i.x/u/a.webp', 'https://i.x/u/b.webp'])
  })

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
    expect(html).toContain('<span style="color:#72ff72">&gt;implying</span>')
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
    expect(escapeHtml('<a & "b">')).toBe('&lt;a &amp; &quot;b&quot;&gt;')
  })
})

describe('third-party text is text (#247)', () => {
  it('shows a typed tag instead of drawing it', () => {
    for (const typed of [
      '<img src="file:///etc/passwd">',
      '<img src=/home/me/.config/nobilis/accounts.toml>',
      '<img src="moho-media://file/?p=/etc/passwd">',
      '<a href="file:///etc/passwd">click</a>',
      '<script>alert(1)</script>'
    ]) {
      const html = formatMessage(typed)
      expect(html, typed).not.toMatch(/<(img|a|script)\b/)
      expect(html, typed).toContain('&lt;')
    }
  })

  it('does not link or embed a file:// URL from a message', () => {
    expect(formatMessage('see file:///etc/passwd')).not.toContain('<a')
    expect(extractMedia('file:///home/me/x.png file:///etc/passwd.jpg')).toEqual([])
  })

  it('keeps a URL inside its own attribute', () => {
    const html = formatMessage('https://x.com/"onmouseover=alert(1)')
    expect(html).not.toContain('"onmouseover')
  })

  it('still draws what it built itself', () => {
    expect(formatMessage('<:ok:1>')).toContain('<img src="https://cdn.discordapp.com/emojis/1.webp')
    expect(formatMessage('<#5>', { channels: { '5': { bufferId: 'b', name: 'c' } } })).toContain('class="channel-mention"')
    expect(formatMessage('a & b < c')).toBe('a &amp; b &lt; c')
  })
})

describe('media in a message', () => {
  it('finds YouTube in every form a link arrives in', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ',
      'https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?t=30&list=PLx&v=dQw4w9WgXcQ&index=2',
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=x',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      'https://youtube.com/watch/dQw4w9WgXcQ'
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
