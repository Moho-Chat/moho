/**
 * Telegram voice chats: one group's or channel's call, held in the window.
 *
 * WebRTC with Telegram's server as the only peer, as Steam's voice is with Valve's (see steamvoice.ts). The window
 * makes an offer; what Telegram wants of it (the ICE ufrag and pwd, the DTLS fingerprint, the audio source and the
 * video source groups) goes up as `joinGroupCall`'s JSON; Telegram answers with the server's transport, from which an
 * answer is built here; and each time people come and go, an offer is built here from who is sending what and
 * answered locally. The daemon carries it all on the account's connection (backend/telegram/voicechat.rs).
 *
 * The SDP is built the way Telegram Web A builds it (Ajaxy/telegram-tt, `src/lib/vibecalls/sdp`, GPL-3.0, as moho
 * is), since it talks to the same server from a browser: an audio section that is ours, a video section that is ours
 * (a blank, disabled track: the server wants one), the data channel, then one receiving section per person speaking.
 *
 * Voice only: other people's video is not shown and this side sends none.
 */

export type TelegramVoicePhase = 'idle' | 'connecting' | 'connected'

/** One person in a voice chat, as the daemon describes them. */
export interface TelegramVoiceParticipant {
  id: string
  name: string
  self: boolean
  muted: boolean
  canSelfUnmute: boolean
  left: boolean
  /** Telegram's (signed) number for their audio stream. */
  source: number
  volume?: number | null
  raisedHand?: boolean
}

export interface TelegramVoiceTarget {
  accountId: string
  bufferId: string
  /** `id:access_hash`, as the daemon hands it out. */
  call: string
  name: string
}

export interface TelegramVoiceEvent {
  accountId: string
  kind: 'call' | 'connection' | 'participants'
  data: Record<string, any>
}

export interface TelegramVoiceHooks {
  rpc: (params: Record<string, unknown>) => Promise<any>
  onChange: () => void
  toast: (kind: 'info' | 'error', message: string) => void
  muted: () => { micMuted: boolean; deafened: boolean }
}

// --- Telegram's JSON and the SDP built from it (after Telegram Web A) -------------------------------------------

export interface Fingerprint {
  hash: string
  setup: string
  fingerprint: string
}

export interface SsrcGroup {
  semantics?: string
  sources: number[]
}

export interface JoinPayload {
  ufrag: string
  pwd: string
  fingerprints: Fingerprint[]
  ssrc?: number
  'ssrc-groups'?: SsrcGroup[]
}

interface Candidate {
  generation: string
  component: string
  protocol: string
  port: string
  ip: string
  foundation: string
  priority: string
  type: string
  'rel-addr'?: string
  'rel-port'?: string
}

interface PayloadType {
  id: number
  name: string
  clockrate: number
  channels: number
  parameters?: Record<string, string | number>
  'rtcp-fbs'?: { type: string; subtype?: string }[]
}

interface Extension {
  id: number
  uri: string
}

export interface ConnectionData {
  transport: { candidates: Candidate[]; pwd: string; ufrag: string; fingerprints: Fingerprint[] }
  audio?: { 'payload-types': PayloadType[]; 'rtp-hdrexts': Extension[] }
  video: { 'payload-types': PayloadType[]; 'rtp-hdrexts': Extension[] }
}

/** One media section: ours (mid 0 audio, 1 video), or somebody else's audio. */
export interface Section {
  userId: string
  endpoint: string
  mid: string
  main: boolean
  removed?: boolean
  video: boolean
  groups: SsrcGroup[]
}

export interface Conference {
  sessionId: number
  audioExtensions: Extension[]
  videoExtensions: Extension[]
  audioPayloadTypes: PayloadType[]
  videoPayloadTypes: PayloadType[]
  sections: Section[]
  transport: ConnectionData['transport']
}

/** Telegram sends sources signed; WebRTC's SSRCs are unsigned. */
export const toTelegramSource = (n: number): number => n << 0
export const fromTelegramSource = (n: number): number => n >>> 0

/** What Telegram wants to know of the local offer, or nothing when the offer lacks it. */
export function parseOffer(sdp: string): JoinPayload | undefined {
  const sections = sdp.split(/\r?\nm=/).map((s, i) => (i === 0 ? s : `m=${s}`))
  const lines = (s: string): string[] => s.split(/\r?\n/).filter(Boolean)
  const audio = sections.find((s) => s.startsWith('m=audio'))
  const video = sections.find((s) => s.startsWith('m=video'))
  const find = (prefix: string, within?: string): string | undefined => {
    for (const s of within ? [within, sections[0]] : sections) {
      const line = lines(s ?? '').find((l) => l.startsWith(prefix))
      if (line) return line.slice(prefix.length)
    }
    return undefined
  }
  const [hash, fingerprint] = (find('a=fingerprint:') ?? '').split(' ')
  const setup = find('a=setup:')
  const ufrag = find('a=ice-ufrag:')
  const pwd = find('a=ice-pwd:')
  if (!hash || !fingerprint || !ufrag || !pwd) return undefined
  const payload: JoinPayload = {
    ufrag,
    pwd,
    fingerprints: [{ hash, fingerprint, setup: setup === 'active' || setup === 'passive' ? setup : 'passive' }]
  }
  const source = audio ? find('a=ssrc:', audio)?.split(' ')[0] : undefined
  if (source) payload.ssrc = toTelegramSource(Number(source))
  const groups = video
    ? lines(video)
        .filter((l) => l.startsWith('a=ssrc-group:'))
        .map((l) => l.slice('a=ssrc-group:'.length).split(' '))
        .filter(([semantics, ...rest]) => semantics && rest.length)
        .map(([semantics, ...rest]) => ({ semantics, sources: rest.map(Number).map(toTelegramSource) }))
    : []
  if (groups.length) payload['ssrc-groups'] = groups
  return payload
}

/** The SDP for Telegram's side: the server's answer to our offer, or its offer of everybody's streams. */
export function buildSdp(conference: Conference, isAnswer: boolean): string {
  const out: string[] = []
  const add = (line: string): void => void out.push(line)
  const { sessionId, sections, transport } = conference
  add('v=0')
  add(`o=- ${sessionId} 2 IN IP4 0.0.0.0`)
  add('s=-')
  add('t=0 0')
  add('a=ice-options:trickle')
  add('a=msid-semantic:WMS *')
  add(`a=group:BUNDLE ${sections.map((s) => s.mid).join(' ')} 2`)
  const addTransport = (): void => {
    add(`a=ice-ufrag:${transport.ufrag}`)
    add(`a=ice-pwd:${transport.pwd}`)
    for (const f of transport.fingerprints) {
      add(`a=fingerprint:${f.hash} ${f.fingerprint}`)
      add(`a=setup:${isAnswer && f.setup !== 'active' && f.setup !== 'passive' ? 'passive' : f.setup || 'passive'}`)
    }
    for (const c of transport.candidates) {
      let line = `a=candidate:${c.foundation} ${c.component} ${c.protocol} ${c.priority} ${c.ip} ${c.port} typ ${c.type}`
      if (c['rel-addr']) line += ` raddr ${c['rel-addr']} rport ${c['rel-port']}`
      add(`${line} generation ${c.generation}`)
    }
  }
  const addPayload = (p: PayloadType): void => {
    add(`a=rtpmap:${p.id} ${p.name}/${p.clockrate}${p.channels > 1 ? `/${p.channels}` : ''}`)
    const params = Object.entries(p.parameters ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
    if (params) add(`a=fmtp:${p.id} ${params}`)
    for (const fb of p['rtcp-fbs'] ?? []) add(`a=rtcp-fb:${p.id} ${fb.type}${fb.subtype ? ` ${fb.subtype}` : ''}`)
  }
  const addSection = (s: Section): void => {
    const types = s.video ? conference.videoPayloadTypes : conference.audioPayloadTypes
    add(`m=${s.video ? 'video' : 'audio'} ${s.removed ? 0 : 1} RTP/SAVPF ${types.map((t) => t.id).join(' ')}`)
    add('c=IN IP4 0.0.0.0')
    add('b=AS:1300')
    add(`a=mid:${s.mid}`)
    add('a=rtcp-mux')
    types.forEach(addPayload)
    add('a=rtcp:1 IN IP4 0.0.0.0')
    if (s.video) add('a=rtcp-rsize')
    for (const { id, uri } of s.video ? conference.videoExtensions : conference.audioExtensions) add(`a=extmap:${id} ${uri}`)
    if (s.removed) {
      add('a=inactive')
      return
    }
    addTransport()
    // The server's own direction: it receives what is ours, and sends what is everybody else's.
    if (isAnswer || s.main) {
      add('a=recvonly')
      return
    }
    add('a=sendonly')
    add('a=bundle-only')
    for (const g of s.groups) {
      if (g.semantics) add(`a=ssrc-group:${g.semantics} ${g.sources.map(fromTelegramSource).join(' ')}`)
      for (const t of g.sources) {
        const ssrc = fromTelegramSource(t)
        add(`a=ssrc:${ssrc} cname:${s.endpoint}`)
        add(`a=ssrc:${ssrc} msid:${s.endpoint} ${s.endpoint}`)
        add(`a=ssrc:${ssrc} mslabel:${s.endpoint}`)
        add(`a=ssrc:${ssrc} label:${s.endpoint}`)
      }
    }
  }
  sections.filter((s) => s.mid === '0' || s.mid === '1').forEach(addSection)
  add('m=application 1 UDP/DTLS/SCTP webrtc-datachannel')
  add('c=IN IP4 0.0.0.0')
  addTransport()
  add('a=ice-options:trickle')
  add('a=mid:2')
  add('a=sctp-port:5000')
  add('a=max-message-size:262144')
  sections.filter((s) => s.mid !== '0' && s.mid !== '1').forEach(addSection)
  return `${out.join('\n')}\n`
}

/**
 * The receiving sections after people came, went, or were muted: a section per person who is sending audio, kept
 * in place (and marked removed) once made, since a section's mid cannot be reused.
 */
export function withParticipants(sections: Section[], people: TelegramVoiceParticipant[], lastMid: number): { sections: Section[]; lastMid: number } {
  const next = sections.map((s) => ({ ...s }))
  let mid = lastMid
  for (const p of people) {
    if (p.self) continue
    const silent = p.left || p.muted
    const mine = next.filter((s) => s.userId === p.id && !s.video)
    let has = false
    for (const s of mine) {
      if (s.groups[0]?.sources[0] === p.source) has = true
      s.removed = silent || s.groups[0]?.sources[0] !== p.source
    }
    if (!silent && !has && p.source) {
      mid += 1
      next.push({ userId: p.id, main: false, endpoint: `audio${fromTelegramSource(p.source)}`, video: false, groups: [{ sources: [p.source] }], mid: String(mid) })
    }
  }
  return { sections: next, lastMid: mid }
}

/** Codecs that use the 90 kHz video clock whatever the server says. */
const NINETY_KHZ = new Set(['VP8', 'VP9', 'H264'])

// --- The call ----------------------------------------------------------------------------------------------------

export class TelegramVoice {
  phase: TelegramVoicePhase = 'idle'
  target: TelegramVoiceTarget | null = null
  /** Who is in it, by Telegram's id. */
  people = new Map<string, TelegramVoiceParticipant>()
  /** Ids of whoever is audible now. */
  speakers = new Set<string>()
  /** Muted by an administrator: this side cannot speak until let. */
  forcedMute = false

  private hooks: TelegramVoiceHooks
  private pc: RTCPeerConnection | null = null
  private mic: MediaStream | null = null
  private blank: MediaStream | null = null
  private audio: AudioContext | null = null
  private sinks = new Map<string, { el: HTMLAudioElement; analyser: AnalyserNode | null; source: MediaStreamAudioSourceNode | null }>()
  private conference: Conference | null = null
  private ownSource = 0
  private lastMid = 3
  private negotiating: Promise<void> = Promise.resolve()
  private meters: ReturnType<typeof setInterval> | null = null
  private epoch = 0

  constructor(hooks: TelegramVoiceHooks) {
    this.hooks = hooks
  }

  get active(): boolean {
    return this.phase !== 'idle'
  }

  /** Joins a group's or channel's voice chat. */
  async join(target: TelegramVoiceTarget, roster: TelegramVoiceParticipant[]): Promise<void> {
    if (this.active) await this.leave()
    const epoch = ++this.epoch
    this.target = target
    this.phase = 'connecting'
    this.people = new Map(roster.filter((p) => !p.left).map((p) => [p.id, p]))
    this.hooks.onChange()
    try {
      await this.openMedia()
      if (epoch !== this.epoch) return
      const pc = new RTCPeerConnection()
      this.pc = pc
      // The server's side of the data channel; this side only needs it to exist.
      pc.createDataChannel('data', { id: 0 })
      const audioTrack = (this.mic ?? this.silence()).getAudioTracks()[0]
      pc.addTrack(audioTrack, new MediaStream([audioTrack]))
      const videoTrack = this.blank?.getVideoTracks()[0]
      if (videoTrack) pc.addTrack(videoTrack, new MediaStream([videoTrack]))
      pc.ontrack = (e) => this.hear(e)
      pc.oniceconnectionstatechange = () => {
        if (pc !== this.pc) return
        const s = pc.iceConnectionState
        if (s === 'connected' || s === 'completed') {
          this.phase = 'connected'
          this.hooks.onChange()
        } else if (s === 'failed') {
          this.fail('The connection to the voice chat failed')
        }
      }
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
      await pc.setLocalDescription(offer)
      const payload = parseOffer(offer.sdp ?? '')
      if (!payload) throw new Error('the browser made an offer Telegram cannot read')
      this.ownSource = payload.ssrc ?? 0
      this.conference = {
        sessionId: Date.now(),
        audioExtensions: [],
        videoExtensions: [],
        audioPayloadTypes: [],
        videoPayloadTypes: [],
        transport: { candidates: [], pwd: '', ufrag: '', fingerprints: [] },
        sections: [
          { userId: '', main: true, video: false, endpoint: '0', mid: '0', groups: [{ sources: [payload.ssrc ?? 0] }] },
          ...(payload['ssrc-groups'] ? [{ userId: '', main: true, video: true, endpoint: '1', mid: '1', groups: payload['ssrc-groups'] }] : [])
        ]
      }
      this.startMeters()
      const { micMuted, deafened } = this.hooks.muted()
      const joined = await this.hooks.rpc({ op: 'join', bufferId: target.bufferId, call: target.call, params: JSON.stringify(payload), muted: micMuted || deafened || !this.mic })
      if (epoch !== this.epoch) return
      if (joined.connection) await this.connected(JSON.parse(joined.connection as string) as ConnectionData)
      // Who is in it now, with their sources, from Telegram.
      const now = await this.hooks.rpc({ op: 'participants', bufferId: target.bufferId, call: target.call })
      if (epoch === this.epoch) this.participants(now.participants as TelegramVoiceParticipant[], true)
    } catch (e) {
      if (epoch === this.epoch) this.fail(`Couldn't join the voice chat: ${(e as Error).message}`)
    }
  }

  async leave(): Promise<void> {
    const { target, ownSource } = this
    const was = this.phase
    this.epoch++
    this.teardown()
    if (!target || was === 'idle') return
    await this.hooks.rpc({ op: 'leave', bufferId: target.bufferId, call: target.call, source: ownSource }).catch(() => {})
  }

  private fail(message: string): void {
    this.hooks.toast('error', message)
    void this.leave()
  }

  private teardown(): void {
    if (this.meters) clearInterval(this.meters)
    this.meters = null
    this.pc?.close()
    this.pc = null
    for (const s of [this.mic, this.blank]) s?.getTracks().forEach((t) => t.stop())
    this.mic = this.blank = null
    for (const { el, source, analyser } of this.sinks.values()) {
      source?.disconnect()
      analyser?.disconnect()
      el.pause()
      el.srcObject = null
      el.remove()
    }
    this.sinks.clear()
    void this.audio?.close().catch(() => {})
    this.audio = null
    this.conference = null
    this.lastMid = 3
    this.phase = 'idle'
    this.target = null
    this.people.clear()
    this.speakers = new Set()
    this.forcedMute = false
    this.hooks.onChange()
  }

  private async openMedia(): Promise<void> {
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    } catch {
      // Listening without a microphone is still being in the voice chat.
      this.mic = null
    }
    // A blank, disabled video track: Telegram's server expects one in the offer.
    try {
      const canvas = Object.assign(document.createElement('canvas'), { width: 640, height: 480 })
      canvas.getContext('2d')?.fillRect(0, 0, 640, 480)
      const stream = canvas.captureStream()
      stream.getVideoTracks().forEach((t) => (t.enabled = false))
      this.blank = stream
    } catch {
      this.blank = null
    }
    this.applyMute(false)
  }

  /** A silent audio track, when there is no microphone. */
  private silence(): MediaStream {
    this.audio ??= new AudioContext()
    const osc = this.audio.createOscillator()
    const dst = this.audio.createMediaStreamDestination()
    osc.connect(dst)
    osc.start()
    dst.stream.getAudioTracks().forEach((t) => (t.enabled = false))
    return dst.stream
  }

  /** Follows the footer's microphone and deafen buttons, and tells Telegram. */
  applyMute(tell = true): void {
    const { micMuted, deafened } = this.hooks.muted()
    const silent = micMuted || deafened || this.forcedMute
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = !silent))
    for (const { el } of this.sinks.values()) el.muted = deafened
    if (tell && this.target && this.phase !== 'idle' && !this.forcedMute) {
      void this.hooks.rpc({ op: 'mute', bufferId: this.target.bufferId, call: this.target.call, muted: silent || !this.mic }).catch(() => {})
    }
  }

  /** The server's transport, which answers our offer. */
  private async connected(data: ConnectionData): Promise<void> {
    const pc = this.pc
    if (!pc || !this.conference) return
    this.conference = {
      ...this.conference,
      transport: data.transport,
      sessionId: Date.now(),
      audioExtensions: data.audio?.['rtp-hdrexts'] ?? this.conference.audioExtensions,
      audioPayloadTypes: data.audio?.['payload-types'] ?? this.conference.audioPayloadTypes,
      videoExtensions: data.video['rtp-hdrexts'],
      videoPayloadTypes: data.video['payload-types'].map((t) => ({ ...t, clockrate: NINETY_KHZ.has(t.name.toUpperCase()) ? 90000 : t.clockrate, channels: 0 }))
    }
    await pc.setRemoteDescription({ type: 'answer', sdp: buildSdp(this.conference, true) })
  }

  /** People came, went, were muted or unmuted: the server's offer of their streams is made again. */
  private participants(list: TelegramVoiceParticipant[], whole = false): void {
    if (whole) this.people.clear()
    for (const p of list) {
      const known = this.people.get(p.id)
      const named = { ...p, name: p.name || known?.name || '' }
      if (p.left) this.people.delete(p.id)
      else this.people.set(p.id, named)
      if (p.self) {
        // Muted by an administrator, who has not let this side speak.
        const forced = p.muted && !p.canSelfUnmute
        if (forced !== this.forcedMute) {
          this.forcedMute = forced
          this.applyMute(false)
          if (forced) this.hooks.toast('info', 'An administrator muted you in this voice chat')
        }
      }
    }
    this.hooks.onChange()
    if (!this.conference?.transport.ufrag) return
    const { sections, lastMid } = withParticipants(this.conference.sections, list, this.lastMid)
    this.conference = { ...this.conference, sections }
    this.lastMid = lastMid
    this.negotiating = this.negotiating.then(() => this.offerAgain()).catch(() => {})
  }

  private async offerAgain(): Promise<void> {
    const pc = this.pc
    if (!pc || !this.conference) return
    await pc.setRemoteDescription({ type: 'offer', sdp: buildSdp(this.conference, false) })
    await pc.setLocalDescription(await pc.createAnswer())
  }

  /** What Telegram says: a call starting or ending, the server's transport, who is in it. */
  handle(event: TelegramVoiceEvent): void {
    const d = event.data
    if (!this.target || event.accountId !== this.target.accountId) return
    switch (event.kind) {
      case 'connection':
        if (!d.presentation && this.conference && !this.conference.transport.ufrag) {
          try {
            void this.connected(JSON.parse(d.params as string) as ConnectionData).catch((e: Error) => this.fail(`The voice chat did not connect: ${e.message}`))
          } catch {
            this.fail('Telegram sent a connection moho could not read')
          }
        }
        break
      case 'participants':
        if (d.call === this.target.call) this.participants(d.participants as TelegramVoiceParticipant[])
        break
      case 'call':
        if (d.call === this.target.call && !d.active) {
          this.hooks.toast('info', 'The voice chat ended')
          this.epoch++
          this.teardown()
        }
        break
    }
  }

  /** Plays one person's audio, through an analyser that says when they speak. */
  private hear(e: RTCTrackEvent): void {
    if (e.track.kind !== 'audio') return
    const section = this.conference?.sections.find((s) => s.mid === e.transceiver.mid)
    if (!section?.userId) return
    const stream = new MediaStream([e.track])
    const old = this.sinks.get(section.userId)
    old?.source?.disconnect()
    old?.el.remove()
    const el = document.createElement('audio')
    el.autoplay = true
    el.srcObject = stream
    el.muted = this.hooks.muted().deafened
    el.style.display = 'none'
    document.body.appendChild(el)
    void el.play().catch(() => {})
    let analyser: AnalyserNode | null = null
    let source: MediaStreamAudioSourceNode | null = null
    try {
      this.audio ??= new AudioContext()
      source = this.audio.createMediaStreamSource(stream)
      analyser = this.audio.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
    } catch {
      analyser = null
    }
    this.sinks.set(section.userId, { el, analyser, source })
  }

  private startMeters(): void {
    const buf = new Uint8Array(512)
    this.meters = setInterval(() => {
      const now = new Set<string>()
      for (const [id, { analyser }] of this.sinks) {
        if (!analyser) continue
        analyser.getByteTimeDomainData(buf)
        let peak = 0
        for (const b of buf) peak = Math.max(peak, Math.abs(b - 128) / 128)
        if (peak > 0.04) now.add(id)
      }
      const same = now.size === this.speakers.size && [...now].every((s) => this.speakers.has(s))
      if (!same) {
        this.speakers = now
        this.hooks.onChange()
      }
    }, 150)
  }
}
