import { describe, expect, it } from 'vitest'
import { isDeepLink, isTelegramLink, parseDeepLink, stoatInviteCode } from './deeplink'

describe('a Telegram link', () => {
  it('is what the View in Telegram button of a post opens, and what a message says', () => {
    for (const url of [
      'tg://resolve?domain=disclosetv&post=21953',
      'https://t.me/disclosetv/21953',
      'https://t.me/disclosetv',
      'https://telegram.me/disclosetv/5',
      'https://t.me/+AbC_d-123',
      'https://t.me/joinchat/AbC_d-123',
      'tg://join?invite=AbC_d-123',
      'https://t.me/c/1234567/89',
      'tg://privatepost?channel=1234567&post=89'
    ]) {
      expect(isTelegramLink(url), url).toBe(true)
      expect(isDeepLink(url), url).toBe(true)
      expect(parseDeepLink(url)).toEqual({ service: 'telegram', url })
    }
  })

  it('is not a page about something else, another host, or another tg: link', () => {
    for (const url of [
      'https://t.me/addstickers/Pack',
      'https://t.me/s/disclosetv',
      'https://t.me/proxy?server=a&port=1',
      'https://t.me/',
      'https://example.com/disclosetv/1',
      'https://t.me.example.com/disclosetv/1',
      'tg://login?token=abc',
      'tg://resolve?domain=telegrampassport',
      'tg://addstickers?set=x'
    ]) {
      expect(isTelegramLink(url), url).toBe(false)
      expect(isDeepLink(url), url).toBe(false)
    }
  })

  it('does not turn an irc link into one, nor the other way round', () => {
    expect(parseDeepLink('irc://irc.libera.chat/moho')?.service).toBe('irc')
    expect(isDeepLink('irc://irc.libera.chat/moho')).toBe(true)
    expect(parseDeepLink('tg://login?token=abc')).toBeNull()
    expect(parseDeepLink('https://kick.com/xqc')?.service).toBe('kick')
  })
})

describe('a Stoat invite', () => {
  it('is read from the official addresses, and only those', () => {
    expect(stoatInviteCode('https://stoat.chat/invite/gJhyqXTt')).toBe('gJhyqXTt')
    expect(stoatInviteCode('https://app.stoat.chat/invite/gJhyqXTt/')).toBe('gJhyqXTt')
    expect(stoatInviteCode('https://rvlt.gg/Abc123')).toBe('Abc123')
    expect(stoatInviteCode('https://stoat.chat/')).toBeNull()
    expect(stoatInviteCode('https://example.com/invite/abc')).toBeNull()
    expect(stoatInviteCode('https://stoat.chat.example.com/invite/abc')).toBeNull()
    expect(stoatInviteCode('https://stoat.chat/invite/a b')).toBeNull()
    expect(parseDeepLink('https://stoat.chat/invite/gJhyqXTt')).toEqual({ service: 'stoat', code: 'gJhyqXTt', url: 'https://stoat.chat/invite/gJhyqXTt' })
    expect(isDeepLink('https://stoat.chat/invite/gJhyqXTt')).toBe(true)
  })
})
