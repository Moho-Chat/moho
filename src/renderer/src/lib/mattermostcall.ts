/**
 * A Mattermost call, held on the Calls plugin's media server (rtcd), as this window's own WebRTC connection.
 *
 * The daemon carries the signalling (backend/mattermost/calls.rs): it opens the call's websocket and says `join`, and
 * passes what the server says (`mattermostCallSignal`) and what this end says (`callSdp`, `callIce`). This end offers
 * first - a data channel and the microphone - and answers the server's offers when it adds somebody's tracks. A track's
 * stream is named by the session that sends it, which the daemon's list of the call's members turns into a person.
 *
 * It answers to the same calls as the LiveKit client (`SfuCall`), so the call bar, the tiles, mute and hang-up are the
 * window's own for this call too.
 */
import type { SfuHandlers, SfuParticipant } from './livekit'

/** Who a session is, as the daemon's list of the call's members says. */
export type SessionUsers = Record<string, string>

export class MattermostCall {
  private pc: RTCPeerConnection | null = null
  private mic: MediaStreamTrack | null = null
  private micSender: RTCRtpSender | null = null
  private screenSenders: RTCRtpSender[] = []
  private remote = new Map<string, { track: MediaStreamTrack; kind: string; session: string }>()
  private pendingCandidates: RTCIceCandidateInit[] = []
  private off: (() => void) | null = null
  private muted = true
  private screen: MediaStream | null = null
  local: MediaStream | null = null
  /** The call's own session id on the server. */
  sessionId = ''

  constructor(
    private bufferId: string,
    private handlers: SfuHandlers,
    private sessionUsers: () => SessionUsers
  ) {}

  private say(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return window.moho.rpc('mattermost', { action, bufferId: this.bufferId, ...params })
  }

  /** Joins (or starts) the call: the server takes the join, then this end offers and the server answers. */
  async join(muted: boolean): Promise<void> {
    const way = await window.moho.rpc<{ iceServers: RTCIceServer[]; sessionId?: string }>('mattermost', { action: 'callJoin', bufferId: this.bufferId })
    this.sessionId = way.sessionId ?? ''
    const pc = new RTCPeerConnection({ iceServers: way.iceServers ?? [] })
    this.pc = pc
    this.off = window.moho.onEvent((e) => {
      if (e.event === 'mattermostCallSignal' && (e.data as { bufferId?: string }).bufferId === this.bufferId) {
        void this.signal((e.data as { data: Record<string, unknown> }).data).catch((err: Error) => this.handlers.onError(`Call signalling: ${err.message}`))
      }
      if (e.event === 'mattermostCallEnded' && (e.data as { bufferId?: string }).bufferId === this.bufferId) {
        const why = (e.data as { error?: string }).error
        if (why) this.handlers.onError(why)
        this.handlers.onConnected(false)
      }
    })
    pc.onicecandidate = (ev) => {
      if (ev.candidate) void this.say('callIce', { candidate: JSON.stringify(ev.candidate) }).catch(() => {})
    }
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState
      if (s === 'connected') this.handlers.onConnected(true)
      if (s === 'failed' || s === 'closed') this.handlers.onConnected(false)
    }
    pc.ontrack = (ev) => {
      // The media server names each stream by the session sending it; what it carries is its kind (a voice, or a screen).
      const session = ev.streams[0]?.id ?? ev.track.id.split('_')[1] ?? ''
      this.remote.set(ev.track.id, { track: ev.track, kind: ev.track.kind === 'video' ? 'screen' : 'voice', session })
      ev.track.onended = () => {
        this.remote.delete(ev.track.id)
        this.handlers.onParticipants(this.people())
      }
      this.handlers.onParticipants(this.people())
    }
    pc.onnegotiationneeded = () => void this.offer()
    // The data channel is what the server expects to find in the first offer.
    pc.createDataChannel('calls-dc')
    // The microphone, sent from the start but silent while muted: unmuting is a track put back, not a new offer.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      this.mic = stream.getAudioTracks()[0] ?? null
    } catch (e) {
      this.handlers.onError(`Couldn't open the microphone: ${(e as Error).message}`)
    }
    if (this.mic) {
      const holder = new MediaStream([this.mic])
      this.micSender = pc.addTrack(this.mic, holder)
      if (muted) await this.micSender.replaceTrack(null)
    }
    this.muted = muted || !this.mic
    this.local = this.mic && !this.muted ? new MediaStream([this.mic]) : null
    if (!this.muted) void this.say('callMute', { muted: false }).catch(() => {})
    this.handlers.onParticipants(this.people())
  }

  private async offer(): Promise<void> {
    const pc = this.pc
    if (!pc) return
    await pc.setLocalDescription()
    if (pc.localDescription) await this.say('callSdp', { sdp: JSON.stringify(pc.localDescription) })
  }

  private async signal(msg: Record<string, unknown>): Promise<void> {
    const pc = this.pc
    if (!pc || !msg) return
    if (msg.type === 'candidate') {
      const candidate = msg.candidate as RTCIceCandidateInit
      if (pc.remoteDescription?.type) await pc.addIceCandidate(candidate).catch(() => {})
      else this.pendingCandidates.push(candidate)
      return
    }
    if (msg.type === 'offer' || msg.type === 'answer') {
      await pc.setRemoteDescription(msg as unknown as RTCSessionDescriptionInit)
      for (const c of this.pendingCandidates.splice(0)) await pc.addIceCandidate(c).catch(() => {})
      if (msg.type === 'offer') {
        await pc.setLocalDescription()
        if (pc.localDescription) await this.say('callSdp', { sdp: JSON.stringify(pc.localDescription) })
      }
    }
  }

  /** Everybody else, with what they are sending: a voice, and a screen where one is shared. */
  people(): SfuParticipant[] {
    const users = this.sessionUsers()
    const bySession = new Map<string, MediaStream>()
    const video = new Set<string>()
    for (const { track, kind, session } of this.remote.values()) {
      if (track.readyState === 'ended' || session === this.sessionId) continue
      const stream = bySession.get(session) ?? new MediaStream()
      stream.addTrack(track)
      bySession.set(session, stream)
      if (kind === 'screen' || kind === 'video') video.add(session)
    }
    return [...bySession.entries()].map(([session, stream]) => ({ key: session, userId: users[session] ?? session, stream, hasVideo: video.has(session) }))
  }

  async toggleMute(): Promise<boolean> {
    await this.setMuted(!this.muted)
    return this.muted
  }

  async setMuted(muted: boolean): Promise<void> {
    if (!this.mic || !this.micSender) {
      this.muted = true
      return
    }
    if (muted === this.muted) return
    await this.micSender.replaceTrack(muted ? null : this.mic)
    this.muted = muted
    this.local = muted ? null : new MediaStream([this.mic])
    await this.say('callMute', { muted })
  }

  /** Mattermost's calls carry no camera in this client (and an unlicensed server none at all). */
  async toggleCamera(): Promise<boolean> {
    this.handlers.onError('Mattermost calls here are voice and screen sharing only')
    return false
  }

  get cameraOn(): boolean {
    return false
  }

  get sharingScreen(): boolean {
    return !!this.screen
  }

  /** Shares a screen already opened, or stops with null. The server is told which stream it is. */
  async setScreen(stream: MediaStream | null): Promise<boolean> {
    const pc = this.pc
    if (!pc) return false
    if (!stream) {
      for (const sender of this.screenSenders) pc.removeTrack(sender)
      this.screenSenders = []
      this.screen?.getTracks().forEach((t) => t.stop())
      this.screen = null
      await this.say('callScreen', { on: false })
      return false
    }
    this.screen = stream
    await this.say('callScreen', { on: true, streamId: stream.id })
    for (const track of stream.getTracks()) this.screenSenders.push(pc.addTrack(track, stream))
    return true
  }

  /** Raises a hand, or lowers it. */
  async setHand(raised: boolean): Promise<void> {
    await this.say('callHand', { raised })
  }

  /** What the connection says is arriving, per session. */
  async arriving(): Promise<{ identity: string; packets: number; samples: number }[]> {
    const pc = this.pc
    if (!pc) return []
    const out = new Map<string, { identity: string; packets: number; samples: number }>()
    for (const receiver of pc.getReceivers()) {
      const entry = this.remote.get(receiver.track.id)
      if (!entry) continue
      const row = out.get(entry.session) ?? { identity: entry.session, packets: 0, samples: 0 }
      const stats = await receiver.getStats()
      stats.forEach((report) => {
        if (report.type !== 'inbound-rtp') return
        row.packets += (report as { packetsReceived?: number }).packetsReceived ?? 0
        row.samples += (report as { totalSamplesReceived?: number }).totalSamplesReceived ?? 0
      })
      out.set(entry.session, row)
    }
    return [...out.values()]
  }

  async leave(): Promise<void> {
    this.off?.()
    this.off = null
    await this.say('callLeave').catch(() => {})
    this.mic?.stop()
    this.screen?.getTracks().forEach((t) => t.stop())
    this.pc?.close()
    this.pc = null
  }
}
