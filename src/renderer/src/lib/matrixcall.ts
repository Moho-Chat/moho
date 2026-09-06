/**
 * A Matrix call, which is a WebRTC call with a room for a telephone exchange.
 *
 * Matrix says the whole of it in events: `m.call.invite` carries the offer,
 * `m.call.answer` the answer, `m.call.candidates` the network paths, and
 * `m.call.hangup` the end. This turns those into the `Call` in webrtc.ts and
 * back again, and knows nothing about how the media works - which is the
 * point of the split.
 *
 * One call at a time per account, which is what the protocol assumes: every
 * event after the invite carries the call id it belongs to, and a second call
 * arriving while one is up is a busy signal rather than a second window.
 */

import { Call, type CallPhase } from './webrtc'

/** What the daemon sends up when a call event arrives in a room. */
export interface MatrixCallEvent {
  accountId: string
  bufferId: string
  /** `m.call.invite`, `m.call.answer`, … */
  kind: string
  callId: string
  from: string
  /** Whether this is our own signalling coming back off the server. */
  own: boolean
  partyId?: string | null
  content: Record<string, any>
}

/** A call being offered to this account, waiting to be answered or refused. */
export interface RingingCall {
  accountId: string
  bufferId: string
  callId: string
  from: string
  /** Whether the offer carries video, so the answer can match it. */
  video: boolean
  offerSdp: string
  /** When the offer stops being good, in epoch milliseconds. */
  expires: number
}

export interface CallSurface {
  send: (bufferId: string, type: string, content: Record<string, unknown>) => void
  iceServers: (accountId: string) => Promise<RTCIceServer[]>
  onRinging: (call: RingingCall | null) => void
  onPhase: (phase: CallPhase, call: ActiveCall | null) => void
  onError: (message: string) => void
}

export interface ActiveCall {
  accountId: string
  bufferId: string
  call: Call
  /** The other end's stream, once it arrives. */
  remote: MediaStream | null
  /** Whether this end offered video at the start. */
  video: boolean
}

/**
 * Whether an offer is for a call with pictures.
 *
 * Read from the SDP rather than from a field, because the SDP is the thing
 * that decides: an offer with a video line wants a camera answered with a
 * camera, and Matrix's own hint for it has changed spelling twice.
 */
export function offerHasVideo(sdp: string): boolean {
  return /^m=video/m.test(sdp)
}

export class MatrixCalls {
  private surface: CallSurface
  private active: ActiveCall | null = null
  private ringing: RingingCall | null = null

  constructor(surface: CallSurface) {
    this.surface = surface
  }

  get current(): ActiveCall | null {
    return this.active
  }

  /** Rings whoever is in this conversation. */
  async place(accountId: string, bufferId: string, video: boolean): Promise<void> {
    if (this.active) {
      this.surface.onError('Already in a call')
      return
    }
    const callId = `moho-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const iceServers = await this.surface.iceServers(accountId)
    const call = this.build(accountId, bufferId, callId, iceServers, true, video)
    this.active = { accountId, bufferId, call, remote: null, video }
    try {
      await call.invite(video)
    } catch (e) {
      this.surface.onError(`Couldn't start the call: ${(e as Error).message}`)
      this.end(false)
    }
  }

  /** Answers the call that is ringing. */
  async answer(video: boolean): Promise<void> {
    const ringing = this.ringing
    if (!ringing) return
    this.ringing = null
    this.surface.onRinging(null)
    const iceServers = await this.surface.iceServers(ringing.accountId)
    const call = this.build(ringing.accountId, ringing.bufferId, ringing.callId, iceServers, false, video)
    this.active = { accountId: ringing.accountId, bufferId: ringing.bufferId, call, remote: null, video }
    try {
      await call.accept(ringing.offerSdp, video)
    } catch (e) {
      this.surface.onError(`Couldn't answer: ${(e as Error).message}`)
      this.end(true)
    }
  }

  /** Refuses it, which is a hangup with a reason. */
  decline(): void {
    const ringing = this.ringing
    if (!ringing) return
    this.ringing = null
    this.surface.onRinging(null)
    this.surface.send(ringing.bufferId, 'm.call.hangup', {
      call_id: ringing.callId,
      version: '1',
      party_id: 'moho',
      reason: 'user_hangup'
    })
  }

  /** Ends whatever is up. */
  end(tell = true): void {
    const active = this.active
    this.active = null
    if (active) void active.call.hangUp('user_hangup', tell)
    this.surface.onPhase('ended', null)
  }

  private build(
    accountId: string,
    bufferId: string,
    callId: string,
    iceServers: RTCIceServer[],
    outgoing: boolean,
    video: boolean
  ): Call {
    const call: Call = new Call({
      id: callId,
      outgoing,
      iceServers,
      handlers: {
        send: (signal) => {
          const base = { call_id: callId, version: '1', party_id: call.partyId }
          // Each signal is its own event type; the shapes differ enough that
          // naming them here is clearer than a table.
          if (signal.kind === 'invite') {
            this.surface.send(bufferId, 'm.call.invite', { ...base, ...signal.content })
          } else if (signal.kind === 'answer') {
            this.surface.send(bufferId, 'm.call.answer', { ...base, ...signal.content })
          } else if (signal.kind === 'candidates') {
            this.surface.send(bufferId, 'm.call.candidates', { ...base, ...signal.content })
          } else if (signal.kind === 'negotiate') {
            // Adding a screen to a call in progress. Its own event type, so a
            // client that does not understand it ignores it rather than
            // treating it as a second call.
            this.surface.send(bufferId, 'm.call.negotiate', {
              ...base,
              lifetime: 30000,
              ...signal.content
            })
          } else if (signal.kind === 'hangup') {
            this.surface.send(bufferId, 'm.call.hangup', { ...base, ...signal.content })
          }
        },
        onRemoteStream: (stream) => {
          if (this.active) this.active.remote = stream
          this.surface.onPhase('connected', this.active)
        },
        onPhase: (phase) => {
          if (phase === 'ended') this.active = null
          this.surface.onPhase(phase, this.active)
        },
        onError: (message) => this.surface.onError(message)
      }
    })
    void video
    return call
  }

  /**
   * One call event out of a room.
   *
   * Our own signalling coming back is mostly ignored - the server echoes
   * everything - except for the one case where it means something: this
   * account answering somewhere else, which stops the ringing here.
   */
  handle(event: MatrixCallEvent): void {
    const { kind, callId, content } = event

    if (event.own) {
      const answeredElsewhere =
        kind === 'm.call.answer' && this.ringing?.callId === callId && content.party_id !== 'moho'
      if (answeredElsewhere) {
        this.ringing = null
        this.surface.onRinging(null)
      }
      return
    }

    if (kind === 'm.call.invite') {
      const sdp = content.offer?.sdp as string | undefined
      if (!sdp) return
      // Our own call, arriving at another of this client's accounts. Somebody
      // signed in twice here and calling themselves is a real thing to do -
      // it is how this was tested - and without this the same window would
      // both ring and answer itself busy, killing the call it had just made.
      if (this.active?.call.id === callId) return
      // Busy: one call at a time, and the other end is told rather than left
      // ringing at nothing.
      if (this.active) {
        this.surface.send(event.bufferId, 'm.call.hangup', {
          call_id: callId,
          version: '1',
          party_id: 'moho',
          reason: 'user_busy'
        })
        return
      }
      const lifetime = typeof content.lifetime === 'number' ? content.lifetime : 60000
      this.ringing = {
        accountId: event.accountId,
        bufferId: event.bufferId,
        callId,
        from: event.from,
        video: offerHasVideo(sdp),
        offerSdp: sdp,
        expires: Date.now() + lifetime
      }
      this.surface.onRinging(this.ringing)
      return
    }

    if (kind === 'm.call.answer' && this.active?.call.id === callId) {
      const sdp = content.answer?.sdp as string | undefined
      if (sdp) void this.active.call.takeAnswer(sdp)
      return
    }

    if (kind === 'm.call.candidates' && this.active?.call.id === callId) {
      const candidates = (content.candidates as RTCIceCandidateInit[] | undefined) ?? []
      void this.active.call.addCandidates(candidates)
      return
    }

    if (kind === 'm.call.negotiate' && this.active?.call.id === callId) {
      const description = content.description as RTCSessionDescriptionInit | undefined
      if (description) void this.active.call.takeNegotiation(description)
      return
    }

    if (kind === 'm.call.hangup' || kind === 'm.call.reject') {
      if (this.ringing?.callId === callId) {
        this.ringing = null
        this.surface.onRinging(null)
      }
      if (this.active?.call.id === callId) this.end(false)
    }
  }
}
