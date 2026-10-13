import { describe, expect, it } from 'vitest'
import { SteamVoice, browserOf, shapeOffer, speakersOf } from './steamvoice'

const hooks = (rpc: (p: Record<string, unknown>) => Promise<unknown> = async () => ({})) => ({
  rpc: rpc as never,
  onChange: () => {},
  toast: () => {},
  muted: () => ({ micMuted: false, deafened: false }),
  nameOf: (_a: string, s: string) => s,
  mayRing: () => true
})

describe('Steam voice', () => {
  it('asks for discontinuous transmission on the opus line and leaves the rest of the offer alone', () => {
    const offer = ['v=0', 'm=audio 9 UDP/TLS/RTP/SAVPF 111 63', 'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=1', 'a=rtpmap:63 red/48000/2', 'a=fmtp:63 111/111', ''].join('\r\n')
    expect(shapeOffer(offer).split('\r\n')).toEqual(['v=0', 'm=audio 9 UDP/TLS/RTP/SAVPF 111 63', 'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1', 'a=rtpmap:63 red/48000/2', 'a=fmtp:63 111/111', ''])
    expect(shapeOffer('v=0\r\n')).toBe('v=0\r\n')
  })

  it('says it is Chrome, which is what Electron is, with the version it has', () => {
    expect(browserOf('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) moho/1.0 Chrome/152.0.7977.130 Electron/44.4.4 Safari/537.36')).toEqual({ name: 'Chrome', version: '152.0.7977.130' })
    expect(browserOf('nothing')).toEqual({ name: 'Chrome', version: '0' })
  })

  it('finds who is speaking from what each stream carries, ignoring streams nobody owns and quiet ones', () => {
    const owners = new Map([[1, '7656'], [2, '7657'], [3, '7658']])
    const sources = [{ source: 1, audioLevel: 0.4 }, { source: 2, audioLevel: 0.001 }, { source: 9, audioLevel: 0.9 }, { source: 3 }]
    expect([...speakersOf(sources, owners)]).toEqual(['7656'])
  })

  it('shows a call as ringing until it is answered or ended, one ring a person', () => {
    const v = new SteamVoice(hooks())
    v.handle({ accountId: 'steam:me', kind: 'callRequested', data: { steamid: '7656', voiceChatId: '10' } })
    v.handle({ accountId: 'steam:me', kind: 'callRequested', data: { steamid: '7657', voiceChatId: '11' } })
    v.handle({ accountId: 'steam:me', kind: 'callRequested', data: { steamid: '7656', voiceChatId: '12' } })
    expect(v.rings.map((r) => [r.steamid, r.voiceChatId])).toEqual([['7657', '11'], ['7656', '12']])
    v.handle({ accountId: 'steam:me', kind: 'ended', data: { voiceChatId: '11' } })
    expect(v.rings.map((r) => r.steamid)).toEqual(['7656'])
  })

  it('does not ring for somebody who may not ring: not a friend, or while the account is busy', () => {
    const v = new SteamVoice({ ...hooks(), mayRing: (_a, s) => s === '7656' })
    v.handle({ accountId: 'steam:me', kind: 'callRequested', data: { steamid: '7657', voiceChatId: '11' } })
    expect(v.rings).toEqual([])
    v.handle({ accountId: 'steam:me', kind: 'callRequested', data: { steamid: '7656', voiceChatId: '12' } })
    expect(v.rings.map((r) => r.steamid)).toEqual(['7656'])
    expect(v.ringFrom('steam:me', '7656')?.voiceChatId).toBe('12')
  })

  it('declining a call says no to Steam and takes the ring away', async () => {
    const sent: Record<string, unknown>[] = []
    const v = new SteamVoice(hooks(async (p) => (sent.push(p), {})))
    v.handle({ accountId: 'steam:me', kind: 'callRequested', data: { steamid: '7656', voiceChatId: '10' } })
    await v.decline(v.rings[0])
    expect(v.rings).toEqual([])
    expect(sent).toEqual([{ op: 'answerCall', accountId: 'steam:me', steamid: '7656', voiceChatId: '10', accept: false }])
  })

  it('does nothing about a call it is not in', () => {
    const v = new SteamVoice(hooks())
    v.handle({ accountId: 'steam:me', kind: 'sessionConnected', data: { ssrc: 1 } })
    v.handle({ accountId: 'steam:me', kind: 'remoteDescription', data: { sdp: '{}' } })
    expect(v.phase).toBe('idle')
  })
})
