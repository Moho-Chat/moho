/**
 * Steam voice: one call, or one room's voice chat, held in the window.
 *
 * Steam's voice is WebRTC with Valve's own server as the only peer. The window
 * offers, the server answers with a description of a relay it holds for the
 * session, and from there audio goes to the relay and comes back mixed, with
 * the server renegotiating as people come and go and saying who is who by stream
 * number. Chromium does all the media; the daemon carries the signalling on the
 * account's connection (backend/steam/voice.rs, which says where each call was
 * read from), and everything it hears comes back as `steamVoice` events.
 *
 * The order is the Steam client's own: open the microphone, make the offer,
 * `initiate`; the server says the session is `sessionConnected`; once the media
 * path is up either `joinRoom` or `requestCall`; then `data`, which names the
 * stream that is ours and is what makes the chat count this connection as being
 * in it. Everything before that is plumbing and nobody is told of it.
 */

/** What a call is doing, in the words a person would use. */
export type SteamVoicePhase = 'idle' | 'starting' | 'connecting' | 'ringing' | 'connected'

/** Where the voice is. */
export type SteamVoiceTarget =
  | { kind: 'room'; groupId: string; roomId: string; bufferId: string; name: string; groupName: string; railId: string }
  | { kind: 'friend'; steamid: string; bufferId: string; name: string; voiceChatId?: string }

/** How somebody in the call is showing, as they last said. */
export interface SteamVoiceStatus {
  micMuted: boolean
  outputMuted: boolean
  noMic: boolean
}

/** What the daemon sends up. */
export interface SteamVoiceEvent {
  accountId: string
  kind: string
  data: Record<string, any>
}

/** Somebody calling this account. */
export interface SteamRing {
  accountId: string
  steamid: string
  voiceChatId: string
}

export interface SteamVoiceHooks {
  /** One call to the daemon's `steamVoice`. */
  rpc: (params: Record<string, unknown>) => Promise<any>
  /** Something about the call that a window shows changed. */
  onChange: () => void
  toast: (kind: 'info' | 'error', message: string) => void
  /** Whether the microphone is muted, and the output, as the footer buttons say. */
  muted: () => { micMuted: boolean; deafened: boolean }
  /** Who a Steam id is, for the name on a ring. */
  nameOf: (accountId: string, steamid: string) => string
  /** Whether a call from this person may ring: a friend, while the account is not invisible or busy. */
  mayRing: (accountId: string, steamid: string) => boolean
}

/** How long a call may take to connect before it is given up on. */
const CONNECT_TIMEOUT_MS = 60_000
/**
 * What the daemon puts at the front of a failure that may be gone in a moment, as the Steam client
 * reads them: it tries again, after a little longer each time, for up to a minute.
 */
export const AGAIN = '[again] '

/** How long to wait before each new try: the Steam client's own, quick at first and then slower. */
const RETRY_DELAYS_MS = [250, 1000, 1000, 5000, 5000, 10000, 10000, 10000, 10000, 10000, 30000]

/** The words of a failure, without the mark that says it may pass. */
export function plainFailure(message: string): string {
  return message.startsWith(AGAIN) ? message.slice(AGAIN.length) : message
}

/** How long somebody has to answer. */
const RING_TIMEOUT_MS = 300_000

/**
 * The offer as the server wants it: the opus line says what the Steam client's own
 * says - discontinuous transmission on, which is what keeps a silent microphone
 * from filling the relay with packets of nothing.
 */
export function shapeOffer(sdp: string): string {
  const lines = sdp.split('\r\n')
  const pt = lines.map((l) => /^a=rtpmap:(\d+)\sopus/.exec(l)?.[1]).find(Boolean)
  if (!pt) return sdp
  return lines.map((l) => (l.startsWith(`a=fmtp:${pt} `) ? `a=fmtp:${pt} minptime=10;useinbandfec=1;usedtx=1` : l)).join('\r\n')
}

/** The browser as the server is told it: its name and its version. */
export function browserOf(userAgent: string): { name: string; version: string } {
  const chrome = /Chrome\/([\d.]+)/.exec(userAgent)
  return { name: 'Chrome', version: chrome?.[1] ?? '0' }
}

/** Who is speaking, from what each stream is carrying and who each stream belongs to. */
export function speakersOf(
  sources: { source: number; audioLevel?: number }[],
  owners: Map<number, string>,
  threshold = 0.02
): Set<string> {
  const out = new Set<string>()
  for (const s of sources) {
    const who = owners.get(s.source)
    if (who && (s.audioLevel ?? 0) > threshold) out.add(who)
  }
  return out
}

export class SteamVoice {
  accountId = ''
  target: SteamVoiceTarget | null = null
  phase: SteamVoicePhase = 'idle'
  /** The loudest the microphone has been in the last moment, 0 to 1. */
  level = 0
  rttMs: number | null = null
  /** Steam ids of whoever is audible. */
  speakers = new Set<string>()
  /** What the others say about themselves. */
  statuses = new Map<string, SteamVoiceStatus>()
  rings: SteamRing[] = []

  private hooks: SteamVoiceHooks
  private pc: RTCPeerConnection | null = null
  private mic: MediaStream | null = null
  private audio: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private sinks = new Map<string, HTMLAudioElement>()
  private voiceChatId = ''
  private session: { ssrc: number; clientIp: number; clientPort: number; serverIp: number; serverPort: number } | null = null
  private iceUp = false
  private joining = false
  private accepted = false
  private owners = new Map<number, string>()
  private updating = false
  private pending: Record<string, any> | null = null
  private meters: ReturnType<typeof setInterval> | null = null
  private stats: ReturnType<typeof setInterval> | null = null
  private deadline: ReturnType<typeof setTimeout> | null = null
  /** Bumped on every start and stop, so what comes back late for a call that is gone is dropped. */
  private epoch = 0
  /** How many times this call has been tried again, and when it first began. */
  private attempt = 0
  private began = 0

  constructor(hooks: SteamVoiceHooks) {
    this.hooks = hooks
  }

  get active(): boolean {
    return this.phase !== 'idle'
  }

  /** Begins voice in a room, or a call to a friend, on an account. */
  async start(accountId: string, target: SteamVoiceTarget, retrying = false): Promise<void> {
    if (this.active) await this.stop()
    if (!retrying) {
      this.attempt = 0
      this.began = Date.now()
    }
    const epoch = ++this.epoch
    this.accountId = accountId
    this.target = target
    this.phase = 'starting'
    this.voiceChatId = target.kind === 'friend' ? (target.voiceChatId ?? '') : ''
    this.session = null
    this.iceUp = false
    this.joining = false
    this.accepted = target.kind === 'friend' && !!target.voiceChatId
    this.hooks.onChange()
    this.deadline = setTimeout(() => this.fail('Voice did not connect'), CONNECT_TIMEOUT_MS)
    try {
      await this.openMic()
      if (epoch !== this.epoch) return
      await this.offer(epoch)
    } catch (e) {
      this.failed(epoch, e as Error, "Couldn't start voice")
    }
  }

  /**
   * A call went wrong: if it may pass, and it is not yet a minute since it began, start it again after
   * the next of the waits the Steam client uses; otherwise say so. What is late for a call that is gone
   * is dropped.
   */
  private failed(epoch: number, error: Error, what: string): void {
    if (epoch !== this.epoch) return
    const target = this.target
    if (error.message.startsWith(AGAIN) && target && Date.now() - this.began < CONNECT_TIMEOUT_MS) {
      const account = this.accountId
      const delay = RETRY_DELAYS_MS[Math.min(this.attempt++, RETRY_DELAYS_MS.length - 1)]
      this.epoch++
      this.teardown()
      setTimeout(() => void this.start(account, target, true), delay)
      return
    }
    this.fail(`${what}: ${plainFailure(error.message)}`)
  }

  /** Leaves: a room is left, and a call is hung up on, which ends it for both. */
  async stop(): Promise<void> {
    const { target, accountId, voiceChatId } = this
    const was = this.phase
    this.epoch++
    this.teardown()
    if (!target || was === 'idle') return
    try {
      if (target.kind === 'room') {
        if (was === 'connected' || voiceChatId) await this.hooks.rpc({ op: 'leaveRoom', accountId, groupId: target.groupId, roomId: target.roomId })
      } else if (voiceChatId) {
        await this.hooks.rpc({ op: 'endCall', accountId, steamid: target.steamid })
      }
    } catch {
      // Already gone: Steam ends it on its side when the connection drops.
    }
  }

  private fail(message: string): void {
    this.hooks.toast('error', message)
    void this.stop()
  }

  private teardown(): void {
    for (const t of [this.deadline]) if (t) clearTimeout(t)
    this.deadline = null
    if (this.meters) clearInterval(this.meters)
    if (this.stats) clearInterval(this.stats)
    this.meters = this.stats = null
    this.pc?.close()
    this.pc = null
    this.mic?.getTracks().forEach((t) => t.stop())
    this.mic = null
    void this.audio?.close().catch(() => {})
    this.audio = null
    this.analyser = null
    for (const el of this.sinks.values()) {
      el.pause()
      el.srcObject = null
      el.remove()
    }
    this.sinks.clear()
    this.phase = 'idle'
    this.target = null
    this.level = 0
    this.rttMs = null
    this.speakers = new Set()
    this.statuses.clear()
    this.owners.clear()
    this.pending = null
    this.updating = false
    this.voiceChatId = ''
    this.session = null
    this.hooks.onChange()
  }

  private async openMic(): Promise<void> {
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    } catch {
      // Listening without a microphone is still a call; the others are told there is none.
      this.mic = null
    }
    this.applyMute()
  }

  /** Follows the footer's microphone and deafen buttons. */
  applyMute(): void {
    const { micMuted, deafened } = this.hooks.muted()
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = !(micMuted || deafened)))
    for (const el of this.sinks.values()) el.muted = deafened
    if (this.phase === 'connected') void this.sendStatus()
  }

  private async sendStatus(): Promise<void> {
    if (!this.voiceChatId) return
    const { micMuted, deafened } = this.hooks.muted()
    await this.hooks
      .rpc({ op: 'status', accountId: this.accountId, voiceChatId: this.voiceChatId, micMuted: micMuted || deafened, outputMuted: deafened, noMic: !this.mic?.getAudioTracks().length, sampleRate: this.audio?.sampleRate ?? 48000 })
      .catch(() => {})
  }

  private async offer(epoch: number): Promise<void> {
    const pc = new RTCPeerConnection()
    this.pc = pc
    this.mic?.getAudioTracks().forEach((t) => pc.addTrack(t, this.mic as MediaStream))
    pc.ontrack = (e) => this.hear(e.track, e.streams[0])
    pc.oniceconnectionstatechange = () => {
      if (pc !== this.pc) return
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        this.iceUp = true
        void this.tryJoin(epoch)
      } else if (pc.iceConnectionState === 'failed') {
        this.fail('The connection to Steam voice failed')
      }
    }
    this.startMeters()
    const made = await pc.createOffer({ offerToReceiveAudio: true, voiceActivityDetection: true } as RTCOfferOptions)
    if (epoch !== this.epoch) return
    const sdp = shapeOffer(made.sdp ?? '')
    await pc.setLocalDescription({ type: 'offer', sdp })
    this.phase = 'connecting'
    this.hooks.onChange()
    const browser = browserOf(navigator.userAgent)
    const answer = await this.hooks.rpc({ op: 'initiate', accountId: this.accountId, sdp: JSON.stringify({ type: 'offer', sdp }), browserName: browser.name, browserVersion: browser.version })
    if (epoch !== this.epoch || pc !== this.pc) return
    const remote = JSON.parse(answer.remoteDescription as string) as RTCSessionDescriptionInit
    await pc.setRemoteDescription(remote)
  }

  /** The media path is up and Steam has said the session is connected: join the chat. */
  private async tryJoin(epoch: number): Promise<void> {
    if (epoch !== this.epoch || this.joining || !this.iceUp || !this.session || !this.target) return
    this.joining = true
    const target = this.target
    try {
      if (target.kind === 'room') {
        const joined = await this.hooks.rpc({ op: 'joinRoom', accountId: this.accountId, groupId: target.groupId, roomId: target.roomId })
        if (epoch !== this.epoch) return
        this.voiceChatId = joined.voiceChatId ?? ''
        await this.connectData(epoch)
      } else if (this.voiceChatId) {
        // Somebody called, and has been answered.
        await this.connectData(epoch)
      } else {
        const asked = await this.hooks.rpc({ op: 'requestCall', accountId: this.accountId, steamid: target.steamid })
        if (epoch !== this.epoch) return
        this.voiceChatId = asked.voiceChatId ?? ''
        this.phase = 'ringing'
        if (this.deadline) clearTimeout(this.deadline)
        this.deadline = setTimeout(() => this.fail(`${target.name} did not answer`), RING_TIMEOUT_MS)
        this.hooks.onChange()
        if (this.accepted) await this.connectData(epoch)
      }
    } catch (e) {
      this.failed(epoch, e as Error, "Couldn't join voice")
    }
  }

  /** Tells the chat which stream is ours, which is what makes this connection part of it. */
  private async connectData(epoch: number): Promise<void> {
    const s = this.session
    if (!s || !this.voiceChatId) return
    await this.hooks.rpc({ op: 'data', accountId: this.accountId, voiceChatId: this.voiceChatId, ssrc: s.ssrc, clientIp: s.clientIp, clientPort: s.clientPort, serverIp: s.serverIp, serverPort: s.serverPort, userAgent: navigator.userAgent, worklets: true, dataChannel: false })
    if (epoch !== this.epoch) return
    if (this.deadline) clearTimeout(this.deadline)
    this.deadline = null
    this.phase = 'connected'
    this.hooks.onChange()
    void this.sendStatus()
  }

  /** What the server says: the session connecting, a new offer, people in the call, a call arriving or ending. */
  handle(event: SteamVoiceEvent): void {
    // Calls arriving and ending concern a window that is not in one too.
    if (event.kind !== 'callRequested' && event.kind !== 'ended' && event.accountId !== this.accountId) return
    const d = event.data
    switch (event.kind) {
      case 'sessionConnected':
        if (!this.active) return
        this.session = { ssrc: d.ssrc, clientIp: d.clientIp, clientPort: d.clientPort, serverIp: d.serverIp, serverPort: d.serverPort }
        void this.tryJoin(this.epoch)
        break
      case 'remoteDescription':
        if (!this.active || !this.pc) return
        if (this.updating) this.pending = d
        else void this.renegotiate(d)
        break
      case 'status': {
        if (d.voiceChatId !== this.voiceChatId) return
        this.statuses.set(d.steamid, { micMuted: !!d.micMuted, outputMuted: !!d.outputMuted, noMic: !!d.noMic })
        this.hooks.onChange()
        break
      }
      case 'allStatus':
        if (d.voiceChatId !== this.voiceChatId) return
        for (const u of d.users ?? []) this.statuses.set(u.steamid, { micMuted: !!u.micMuted, outputMuted: !!u.outputMuted, noMic: !!u.noMic })
        this.hooks.onChange()
        break
      case 'ended':
        if (this.active && d.voiceChatId === this.voiceChatId) {
          this.hooks.toast('info', this.target?.kind === 'friend' ? 'The call ended' : 'Voice ended')
          this.epoch++
          this.teardown()
        }
        this.rings = this.rings.filter((r) => r.voiceChatId !== d.voiceChatId)
        this.hooks.onChange()
        break
      case 'shouldRejoin':
        // Steam moved the room's voice to another server: start again where we were.
        if (this.target?.kind === 'room' && this.target.groupId === d.groupId && this.target.roomId === d.roomId) {
          const [account, target] = [this.accountId, this.target]
          this.epoch++
          this.teardown()
          setTimeout(() => void this.start(account, target), 250)
        }
        break
      case 'callRequested':
        this.ring(event.accountId, d.steamid, d.voiceChatId)
        break
      case 'callResponse':
        if (d.voiceChatId !== this.voiceChatId || this.target?.kind !== 'friend') return
        if (d.accepted) {
          this.accepted = true
          if (this.phase === 'ringing') void this.connectData(this.epoch).catch((e: Error) => this.failed(this.epoch, e, "Couldn't join the call"))
        } else {
          this.hooks.toast('info', `${this.target.name} declined`)
          void this.stop()
        }
        break
    }
  }

  private ring(accountId: string, steamid: string, voiceChatId: string): void {
    // The Steam client ignores a call from somebody who is not a friend, or while it is invisible or busy.
    if (!this.hooks.mayRing(accountId, steamid)) return
    // Already talking to them: it is them calling back to be let in again.
    if (this.target?.kind === 'friend' && this.target.steamid === steamid && this.active) {
      void this.hooks.rpc({ op: 'answerCall', accountId, steamid, voiceChatId, accept: true }).catch(() => {})
      return
    }
    this.rings = [...this.rings.filter((r) => r.steamid !== steamid), { accountId, steamid, voiceChatId }]
    this.hooks.onChange()
  }

  /** The ring from this person, if there is one: somebody calling who is then called back is answered instead. */
  ringFrom(accountId: string, steamid: string): SteamRing | undefined {
    return this.rings.find((r) => r.accountId === accountId && r.steamid === steamid)
  }

  /** Says yes to a call, and joins it. */
  async answer(ring: SteamRing, bufferId: string, name: string): Promise<void> {
    this.rings = this.rings.filter((r) => r !== ring)
    this.hooks.onChange()
    try {
      await this.hooks.rpc({ op: 'answerCall', accountId: ring.accountId, steamid: ring.steamid, voiceChatId: ring.voiceChatId, accept: true })
    } catch (e) {
      this.hooks.toast('error', `Couldn't answer: ${plainFailure((e as Error).message)}`)
      return
    }
    await this.start(ring.accountId, { kind: 'friend', steamid: ring.steamid, bufferId, name, voiceChatId: ring.voiceChatId })
  }

  async decline(ring: SteamRing): Promise<void> {
    this.rings = this.rings.filter((r) => r !== ring)
    this.hooks.onChange()
    await this.hooks.rpc({ op: 'answerCall', accountId: ring.accountId, steamid: ring.steamid, voiceChatId: ring.voiceChatId, accept: false }).catch(() => {})
  }

  /** The server's new description of the session, which is an offer: take it and answer. */
  private async renegotiate(d: Record<string, any>): Promise<void> {
    const pc = this.pc
    if (!pc) return
    this.updating = true
    this.owners = new Map((d.ssrcs ?? []).map((m: { ssrc: number; steamid: string }) => [m.ssrc, m.steamid]))
    try {
      const remote = JSON.parse(d.sdp as string) as RTCSessionDescriptionInit
      await pc.setRemoteDescription(remote)
      if (remote.type === 'offer') {
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        const s = this.session
        // The Steam client sends this and does not look at what comes back, and Steam may well refuse one that
        // reaches it before the session has joined the chat. The offer is answered either way, so a refusal is
        // not the end of the call.
        await this.hooks
          .rpc({ op: 'acknowledge', accountId: this.accountId, version: d.version, serverIp: s?.serverIp, serverPort: s?.serverPort, clientIp: s?.clientIp, clientPort: s?.clientPort })
          .catch(() => {})
      }
    } catch (e) {
      this.fail(`Voice renegotiation failed: ${plainFailure((e as Error).message)}`)
      return
    }
    this.updating = false
    const next = this.pending
    this.pending = null
    if (next) await this.renegotiate(next)
  }

  /** Plays what the server sends, one element per stream so each can be silenced with the rest. */
  private hear(track: MediaStreamTrack, stream: MediaStream | undefined): void {
    if (track.kind !== 'audio') return
    const owned = stream ?? new MediaStream([track])
    const el = this.sinks.get(owned.id) ?? document.createElement('audio')
    el.autoplay = true
    el.srcObject = owned
    el.muted = this.hooks.muted().deafened
    el.style.display = 'none'
    document.body.appendChild(el)
    void el.play().catch(() => {})
    this.sinks.set(owned.id, el)
  }

  /** The microphone's level and who else is audible, often; the round trip, less so. */
  private startMeters(): void {
    if (this.mic?.getAudioTracks().length) {
      try {
        this.audio = new AudioContext()
        const source = this.audio.createMediaStreamSource(this.mic)
        this.analyser = this.audio.createAnalyser()
        this.analyser.fftSize = 512
        source.connect(this.analyser)
      } catch {
        this.analyser = null
      }
    }
    const buf = new Uint8Array(512)
    this.meters = setInterval(() => {
      let level = 0
      if (this.analyser) {
        this.analyser.getByteTimeDomainData(buf)
        let peak = 0
        for (const b of buf) peak = Math.max(peak, Math.abs(b - 128) / 128)
        // The mic reads on a log-ish scale to a person; speech sits well under full.
        level = this.mic?.getAudioTracks()[0]?.enabled ? Math.min(1, peak * 2) : 0
      }
      const sources: { source: number; audioLevel?: number }[] = []
      for (const r of this.pc?.getReceivers() ?? []) {
        for (const s of r.getSynchronizationSources?.() ?? []) sources.push(s)
      }
      const speakers = speakersOf(sources, this.owners)
      const same = speakers.size === this.speakers.size && [...speakers].every((s) => this.speakers.has(s))
      this.level = level
      if (!same) {
        this.speakers = speakers
        this.hooks.onChange()
      }
    }, 120)
    this.stats = setInterval(() => {
      void this.pc?.getStats().then((report) => {
        report.forEach((s) => {
          if (s.type === 'candidate-pair' && s.nominated && typeof s.currentRoundTripTime === 'number') this.rttMs = Math.round(s.currentRoundTripTime * 1000)
        })
      })
    }, 1000)
  }
}
