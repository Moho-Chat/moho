import { describe, expect, it } from 'vitest'
import { replyPreviewHtml } from './replypreview'

describe('what a reply quotes, as words', () => {
  it('draws a Kick emote as its picture, not its code', () => {
    const html = replyPreviewHtml('[emote:5756632:SUSSY][emote:5756632:SUSSY]', { service: 'kick' })
    expect(html).not.toContain('[emote:')
    expect(html.match(/<img /g)).toHaveLength(2)
    expect(html).toContain('alt=":SUSSY:"')
  })

  it('draws a Discord custom emoji', () => {
    const html = replyPreviewHtml('nice <:pog:123456789012345678> and <a:spin:223456789012345678>', { service: 'discord' })
    expect(html).not.toContain('&lt;:pog')
    expect(html.match(/<img /g)).toHaveLength(2)
  })

  it('draws Twitch and Steam emotes and stickers', () => {
    expect(replyPreviewHtml('[twitch:emote:25:Kappa] hi', { service: 'twitch' })).toMatch(/<img [^>]*alt="Kappa"/)
    expect(replyPreviewHtml('[twitch:aemote:300:LUL]', { service: 'twitch' })).toContain('<img ')
    expect(replyPreviewHtml('[steam:emote:steamhappy]', { service: 'steam' })).toContain('<img ')
  })

  it('draws a Sneedchat smilie when it is known', () => {
    const smilies = { regex: /:smile:/, byAlias: { ':smile:': { url: 'x.png' } } } as never
    expect(replyPreviewHtml(':smile: ok', { service: 'sneedchat', smilies })).toContain('<img src="x.png"')
  })

  it('leaves plain words plain, and escapes what is not markup', () => {
    expect(replyPreviewHtml('just words', {})).toBe('just words')
    expect(replyPreviewHtml('<img src=x onerror=alert(1)>', {})).not.toContain('<img')
  })

  it('shows a link as its words and keeps a spoiler hidden', () => {
    const link = replyPreviewHtml('see https://example.org/page now', {})
    expect(link).not.toContain('<a ')
    expect(link).toContain('example.org/page')
    const spoiler = replyPreviewHtml('||secret||', {})
    expect(spoiler).toContain('spoiler')
    expect(spoiler).not.toContain('revealed')
  })

  it('has nothing for nothing', () => {
    expect(replyPreviewHtml('', {})).toBe('')
  })
})
