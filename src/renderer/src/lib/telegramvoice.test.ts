import { describe, expect, it } from 'vitest'
import { buildSdp, fromTelegramSource, parseOffer, toTelegramSource, withParticipants, type Conference, type TelegramVoiceParticipant } from './telegramvoice'

const OFFER = [
  'v=0',
  'o=- 1 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1 2',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=ice-ufrag:abcd',
  'a=ice-pwd:secretpassword',
  'a=fingerprint:sha-256 AA:BB:CC',
  'a=setup:actpass',
  'a=mid:0',
  'a=ssrc:3000000000 cname:x',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97',
  'a=mid:1',
  'a=ssrc-group:FID 111 222',
  'a=ssrc:111 cname:x',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'a=mid:2'
].join('\r\n')

describe("what Telegram is told of the window's offer", () => {
  it('takes the ICE credentials, the fingerprint, the audio source signed and the video groups', () => {
    const p = parseOffer(OFFER)
    expect(p?.ufrag).toBe('abcd')
    expect(p?.pwd).toBe('secretpassword')
    expect(p?.fingerprints).toEqual([{ hash: 'sha-256', fingerprint: 'AA:BB:CC', setup: 'passive' }])
    expect(p?.ssrc).toBe(toTelegramSource(3000000000))
    expect(p?.ssrc).toBeLessThan(0)
    expect(p?.['ssrc-groups']).toEqual([{ semantics: 'FID', sources: [111, 222] }])
  })

  it('refuses an offer without the credentials', () => {
    expect(parseOffer('v=0\r\nm=audio 9 RTP 111')).toBeUndefined()
  })

  it('turns sources back the other way', () => {
    expect(fromTelegramSource(toTelegramSource(4000000000))).toBe(4000000000)
  })
})

const conference = (): Conference => ({
  sessionId: 7,
  audioExtensions: [{ id: 1, uri: 'urn:ietf:params:rtp-hdrext:ssrc-audio-level' }],
  videoExtensions: [],
  audioPayloadTypes: [{ id: 111, name: 'opus', clockrate: 48000, channels: 2, parameters: { minptime: 10, useinbandfec: 1 } }],
  videoPayloadTypes: [{ id: 100, name: 'VP8', clockrate: 90000, channels: 0 }],
  transport: {
    ufrag: 'srv',
    pwd: 'srvpwd',
    fingerprints: [{ hash: 'sha-256', fingerprint: 'DD:EE', setup: 'active' }],
    candidates: [{ generation: '0', component: '1', protocol: 'udp', port: '443', ip: '203.0.113.5', foundation: '1', priority: '1', type: 'host' }]
  },
  sections: [
    { userId: '', main: true, video: false, endpoint: '0', mid: '0', groups: [{ sources: [5] }] },
    { userId: '', main: true, video: true, endpoint: '1', mid: '1', groups: [{ semantics: 'FID', sources: [111, 222] }] }
  ]
})

describe("Telegram's side of the call as SDP", () => {
  it('answers our own sections, with the data channel between them and the server as the place to send', () => {
    const sdp = buildSdp(conference(), true)
    expect(sdp).toContain('a=group:BUNDLE 0 1 2')
    expect(sdp).toContain('a=rtpmap:111 opus/48000/2')
    expect(sdp).toContain('a=fmtp:111 minptime=10; useinbandfec=1')
    expect(sdp).toContain('a=candidate:1 1 udp 1 203.0.113.5 443 typ host generation 0')
    expect(sdp).toContain('a=setup:active')
    expect(sdp.match(/a=recvonly/g)?.length).toBe(2)
    expect(sdp.indexOf('m=application')).toBeGreaterThan(sdp.indexOf('a=mid:1'))
  })

  it("offers each person's audio as a section of its own, and marks one that stopped", () => {
    const people: TelegramVoiceParticipant[] = [
      { id: '9', name: 'Ada', self: false, muted: false, canSelfUnmute: true, left: false, source: -5 },
      { id: '1', name: 'Me', self: true, muted: false, canSelfUnmute: true, left: false, source: 5 },
      { id: '8', name: 'Bo', self: false, muted: true, canSelfUnmute: true, left: false, source: 6 }
    ]
    const first = withParticipants(conference().sections, people, 3)
    expect(first.sections.map((s) => s.mid)).toEqual(['0', '1', '4'])
    expect(first.lastMid).toBe(4)
    const offer = buildSdp({ ...conference(), sections: first.sections }, false)
    expect(offer).toContain(`a=ssrc:${fromTelegramSource(-5)} cname:audio${fromTelegramSource(-5)}`)
    expect(offer).toContain('a=sendonly')
    const left = withParticipants(first.sections, [{ ...people[0], left: true }], first.lastMid)
    expect(left.sections.find((s) => s.mid === '4')?.removed).toBe(true)
    expect(buildSdp({ ...conference(), sections: left.sections }, false)).toContain('m=audio 0 RTP/SAVPF')
    const back = withParticipants(left.sections, [people[0]], left.lastMid)
    expect(back.sections.find((s) => s.mid === '4')?.removed).toBe(false)
    expect(back.lastMid).toBe(4)
  })
})
