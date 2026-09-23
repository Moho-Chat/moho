/**
 * One end of a call, in the window rather than in the daemon.
 *
 * A call is WebRTC: two peers agreeing codecs and network paths, then sending
 * each other encrypted RTP with echo cancellation, jitter buffers and hardware
 * decode in between. This window is Chromium, which has all of that; the
 * daemon has none of it, and writing it there in Rust would be writing a
 * browser badly. So the media lives here and the daemon carries the
 * signalling, which genuinely is its job - on Matrix the offer, the answer and
 * the network candidates are events in a room, and rooms are what it knows.
 *
 * That is the same division Discord's voice already draws from the other side:
 * there the daemon holds the audio because the connection is a bespoke
 * protocol no browser speaks. Where the protocol is the browser's, the browser
 * holds it.
 *
 * Deliberately protocol-agnostic. Nothing below knows what Matrix is: it is
 * given a way to send a signal and told when one arrives, which is all a call
 * needs from whatever is carrying it.
 */

/** What a call is doing, in the words a person would use. */
export type CallPhase = 'ringing' | 'connecting' | 'connected' | 'ended'

export interface CallSignal {
  /** `offer`, `answer`, `candidates`, `hangup` - what happened. */
  kind: string
  content: Record<string, unknown>
}

export interface CallHandlers {
  /** Sends one signal to the other end. */
  send: (signal: CallSignal) => void
  /** The other end's audio and video, once there is any. */
  onRemoteStream: (stream: MediaStream) => void
  onPhase: (phase: CallPhase) => void
  /** Something went wrong that the person should hear about. */
  onError: (message: string) => void
}

/** How long to wait for an answer before giving up on an unanswered call. */
const RING_TIMEOUT_MS = 60_000

/**
 * A call in progress.
 *
 * Holds the peer connection, the local tracks and the small amount of state
 * that decides what an arriving signal means. One per call; a second call is a
 * second instance, and the caller decides whether that is allowed.
 */
export class Call {
  readonly id: string
  readonly outgoing: boolean
  /** The party id both ends put on every signal, so a call answered on
   *  another device can be told apart from this one. */
  readonly partyId: string

  private pc: RTCPeerConnection
  private local: MediaStream | null = null
  private remote = new MediaStream()
  private handlers: CallHandlers
  // Starts as nothing rather than as ringing: the first real phase has to be
  // announced, and a call whose initial value already said "ringing" told the
  // window nothing when it started ringing - so no call ever appeared.
  private phase: CallPhase | 'new' = 'new'
  private ringTimer: ReturnType<typeof setTimeout> | null = null
  /** Candidates found before there was anywhere to send them. */
  private pending: RTCIceCandidateInit[] = []
  private answered = false
  /** The screen track while one is being shared, so it can be stopped. */
  private screen: MediaStreamTrack | null = null
  /**
   * The camera track this leg is sending, while it is sending one.
   *
   * Held separately from `local` because a leg can be sending a camera, a
   * screen, both or neither, and "the video track" is ambiguous the moment
   * there are two of them - the screen-share code below would otherwise
   * switch off somebody's face when they stopped sharing.
   */
  private camera: MediaStreamTrack | null = null
  /** Media opened by somebody else and lent to this leg - see the
   *  constructor. Never stopped here, because it is not this leg's to stop. */
  private shared: MediaStream | null = null

  constructor(opts: {
    id: string
    outgoing: boolean
    iceServers: RTCIceServer[]
    handlers: CallHandlers
    /**
     * A camera and microphone already open, to use instead of opening more.
     *
     * A call between two people opens its own. A call between five is five
     * connections, and asking the machine for the camera five times gets
     * five captures of the same camera - or, on most machines, one capture
     * and four failures. So the group opens it once and hands it to each
     * leg.
     */
    local?: MediaStream | null
  }) {
    this.id = opts.id
    this.outgoing = opts.outgoing
    this.handlers = opts.handlers
    this.partyId = `moho-${Math.random().toString(36).slice(2, 10)}`
    this.shared = opts.local ?? null
    this.pc = new RTCPeerConnection({ iceServers: opts.iceServers })

    // Candidates are found for as long as a call lasts, not only at the
    // start: a network changing under a call is exactly when the later ones
    // matter, and a client that stopped listening after connecting would drop
    // the call rather than move it.
    this.pc.onicecandidate = (e) => {
      if (!e.candidate) return
      const candidate = {
        candidate: e.candidate.candidate,
        sdpMid: e.candidate.sdpMid,
        sdpMLineIndex: e.candidate.sdpMLineIndex
      }
      // Nowhere to send them until the other end knows about the call.
      if (!this.answered && this.outgoing) this.pending.push(candidate)
      else this.handlers.send({ kind: 'candidates', content: { candidates: [candidate] } })
    }

    this.pc.ontrack = (e) => {
      for (const track of e.streams[0]?.getTracks() ?? [e.track]) {
        if (this.remote.getTracks().some((t) => t.id === track.id)) continue
        this.remote.addTrack(track)
        // A track the other end takes away - a camera switched off, a screen
        // share stopped - has to leave this stream, or the tile keeps drawing
        // the last frame it received for ever. Chromium reports it as a mute
        // before it reports it as an end, and on a removed track the mute is
        // often all there is.
        const drop = (): void => {
          this.remote.removeTrack(track)
          this.handlers.onRemoteStream(this.remote)
        }
        track.onended = drop
        track.onmute = drop
        // And back again when they turn it on: the same transceiver is
        // reused, so the track unmutes rather than a new one arriving.
        track.onunmute = () => {
          if (!this.remote.getTracks().some((t) => t.id === track.id)) this.remote.addTrack(track)
          this.handlers.onRemoteStream(this.remote)
        }
      }
      this.handlers.onRemoteStream(this.remote)
    }

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState
      if (state === 'connected') this.setPhase('connected')
      // "failed" is over; "disconnected" is not, and often comes back on its
      // own when a network hiccups. Treating the second as the first is how
      // a call ends itself over a lift ride.
      if (state === 'failed' || state === 'closed') this.setPhase('ended')
    }
  }

  /**
   * What to show this end of the call.
   *
   * The screen when one is being shared, the camera otherwise: every client
   * previews what it is sending, and a black square while sharing is the one
   * moment somebody most wants to check what the room can see.
   */
  get stream(): MediaStream | null {
    if (this.screen) {
      const preview = new MediaStream([this.screen])
      return preview
    }
    return this.local
  }

  get remoteStream(): MediaStream {
    return this.remote
  }

  /**
   * This end's microphone, separate from what the tile shows.
   *
   * `stream` above answers "what should be drawn", which is the screen while
   * one is being shared. Measuring whether somebody is talking has to follow
   * the microphone wherever the picture goes.
   */
  get localAudio(): MediaStream | null {
    return this.local
  }

  get sharingScreen(): boolean {
    return !!this.screen
  }

  get cameraOn(): boolean {
    return !!this.camera && this.camera.readyState === 'live'
  }

  private setPhase(phase: CallPhase): void {
    if (this.phase === phase || this.phase === 'ended') return
    this.phase = phase
    this.handlers.onPhase(phase)
  }

  /**
   * Microphone, and camera when this is a video call.
   *
   * A machine with no camera still makes calls. Asking for one it does not
   * have fails the whole request - audio included - so a refused camera falls
   * back to voice rather than to nothing, which is what somebody pressing
   * "video call" on a desktop with no webcam actually wants.
   */
  private async openLocal(video: boolean): Promise<void> {
    // Already open, and open for several legs at once: take it as it is.
    if (this.shared) {
      this.local = this.shared
      this.camera = this.shared.getVideoTracks()[0] ?? null
      for (const track of this.shared.getTracks()) this.pc.addTrack(track, this.shared)
      return
    }
    const audio = { echoCancellation: true, noiseSuppression: true }
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio, video })
    } catch (e) {
      const name = (e as Error).name
      const noCamera = name === 'NotFoundError' || name === 'NotAllowedError' || name === 'OverconstrainedError'
      if (!video || !noCamera) throw e
      this.handlers.onError('No camera here - calling with audio only')
      this.local = await navigator.mediaDevices.getUserMedia({ audio, video: false })
    }
    this.camera = this.local.getVideoTracks()[0] ?? null
    for (const track of this.local.getTracks()) this.pc.addTrack(track, this.local)
  }

  /** Rings somebody: opens the local media and sends the offer. */
  async invite(video: boolean): Promise<void> {
    await this.openLocal(video)
    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)
    this.setPhase('ringing')
    this.handlers.send({
      kind: 'invite',
      content: {
        offer: { type: 'offer', sdp: offer.sdp },
        lifetime: RING_TIMEOUT_MS
      }
    })
    this.ringTimer = setTimeout(() => {
      if (this.phase === 'ringing') {
        this.handlers.onError('No answer')
        void this.hangUp('invite_timeout')
      }
    }, RING_TIMEOUT_MS)
  }

  /** Answers a call that is ringing here. */
  async accept(offerSdp: string, video: boolean): Promise<void> {
    this.setPhase('connecting')
    await this.pc.setRemoteDescription({ type: 'offer', sdp: offerSdp })
    await this.openLocal(video)
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)
    this.answered = true
    this.handlers.send({ kind: 'answer', content: { answer: { type: 'answer', sdp: answer.sdp } } })
    this.flushCandidates()
  }

  /** The other end answered a call this window made. */
  async takeAnswer(answerSdp: string): Promise<void> {
    if (this.answered) return
    this.answered = true
    if (this.ringTimer) clearTimeout(this.ringTimer)
    this.setPhase('connecting')
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
    this.flushCandidates()
  }

  /** Network paths from the other end. */
  async addCandidates(candidates: RTCIceCandidateInit[]): Promise<void> {
    for (const candidate of candidates) {
      // A candidate for a call whose description has not arrived yet is not
      // an error worth showing anybody - it is a race the specification
      // expects, and the browser keeps them once there is a description.
      try {
        await this.pc.addIceCandidate(candidate)
      } catch {
        /* not usable yet, or already known */
      }
    }
  }

  private flushCandidates(): void {
    if (this.pending.length === 0) return
    this.handlers.send({ kind: 'candidates', content: { candidates: this.pending } })
    this.pending = []
  }

  /** Silences the microphone, or lets it speak again. Returns muted. */
  toggleMute(): boolean {
    const track = this.local?.getAudioTracks()[0]
    if (!track) return false
    track.enabled = !track.enabled
    return !track.enabled
  }

  /**
   * Turns the camera on or off. Returns whether it is now on.
   *
   * Added and removed rather than enabled and disabled. A disabled track
   * keeps sending - a black rectangle at whatever frame rate the encoder
   * feels like - so the other end sees a dark square where a face was and
   * cannot tell that from a camera that has frozen. Removing the track ends
   * it properly: every other client then draws the person's name or avatar,
   * which is what "camera off" is supposed to look like.
   *
   * The cost is a renegotiation each way, which is the same cost sharing a
   * screen already pays and is unnoticeable beside the second the camera
   * takes to open.
   *
   * `source` is a capture somebody else opened - the group call opens one
   * camera and lends it to every leg, because asking the machine five times
   * for the same camera gets one capture and four refusals. A track lent
   * this way is never stopped here.
   */
  async setCamera(on: boolean, source?: MediaStream | null): Promise<boolean> {
    if (on === this.cameraOn) return this.cameraOn

    if (!on) {
      const track = this.camera
      this.camera = null
      if (!track) return false
      const sender = this.pc.getSenders().find((s) => s.track === track)
      if (sender) this.pc.removeTrack(sender)
      // Not a lent one: the other legs of this call are still sending it.
      if (!this.shared) {
        track.stop()
        this.local?.removeTrack(track)
      }
      await this.renegotiate()
      return false
    }

    let stream = source ?? null
    if (!stream) {
      // Its own request rather than reopening the microphone with it: the
      // microphone is already open and already being listened to, and asking
      // for both again would interrupt the audio to add a picture.
      stream = await navigator.mediaDevices.getUserMedia({ video: true })
    }
    const track = stream.getVideoTracks()[0]
    if (!track) return false
    this.camera = track
    // The browser's own "stop" - a camera unplugged, a privacy shutter, the
    // device taken by something else - has to reach the call, or the far end
    // keeps a frozen last frame for ever.
    track.onended = () => void this.setCamera(false)
    if (!this.local) this.local = new MediaStream()
    if (!this.shared && !this.local.getTracks().includes(track)) this.local.addTrack(track)
    this.pc.addTrack(track, this.local)
    await this.renegotiate()
    return true
  }

  /**
   * Shares a screen or a window, or stops.
   *
   * Added as its own track rather than replacing the camera: a person sharing
   * their screen is still in the call, and every other client shows both.
   * Renegotiation follows, because a new track is a new description.
   */
  async shareScreen(source?: MediaStream): Promise<boolean> {
    if (this.screen) {
      this.screen.stop()
      const sender = this.pc.getSenders().find((s) => s.track === this.screen)
      if (sender) this.pc.removeTrack(sender)
      this.screen = null
      await this.renegotiate()
      return false
    }
    const stream = source ?? (await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }))
    const track = stream.getVideoTracks()[0]
    if (!track) return false
    this.screen = track
    // Stopping from the browser's own "stop sharing" control has to reach the
    // call too, or the other end keeps a frozen last frame.
    track.onended = () => void this.shareScreen()
    this.pc.addTrack(track, stream)
    await this.renegotiate()
    return true
  }

  /**
   * One renegotiation at a time.
   *
   * Turning a camera on and sharing a screen a second later are two changes
   * to the same connection, and starting the second offer while the first is
   * still unanswered puts the peer connection in a state neither end can
   * recover from - the browser throws and the call is left half-described.
   * Chained rather than dropped, because both changes were asked for and both
   * have to happen.
   */
  private pendingNegotiation: Promise<void> = Promise.resolve()

  private renegotiate(): Promise<void> {
    this.pendingNegotiation = this.pendingNegotiation.then(async () => {
      if (this.phase === 'ended') return
      const offer = await this.pc.createOffer()
      await this.pc.setLocalDescription(offer)
      this.handlers.send({ kind: 'negotiate', content: { description: { type: 'offer', sdp: offer.sdp } } })
    })
    return this.pendingNegotiation
  }

  /**
   * A renegotiation from the other end - somebody turning a camera on, or
   * starting to share.
   *
   * Queued behind this end's own, for the reason above: two descriptions
   * being applied to one connection at once is how a call ends up describing
   * something neither end is sending.
   */
  takeNegotiation(description: RTCSessionDescriptionInit): Promise<void> {
    this.pendingNegotiation = this.pendingNegotiation.then(async () => {
      if (this.phase === 'ended') return
      await this.pc.setRemoteDescription(description)
      if (description.type !== 'offer') return
      const answer = await this.pc.createAnswer()
      await this.pc.setLocalDescription(answer)
      this.handlers.send({ kind: 'negotiate', content: { description: { type: 'answer', sdp: answer.sdp } } })
    })
    return this.pendingNegotiation
  }

  /** Ends the call, telling the other end unless it was them who ended it. */
  async hangUp(reason?: string, tell = true): Promise<void> {
    if (this.ringTimer) clearTimeout(this.ringTimer)
    if (tell) this.handlers.send({ kind: 'hangup', content: reason ? { reason } : {} })
    // Not the shared capture: other legs of the same call are still using it,
    // and stopping it here would take the camera away from all of them.
    if (!this.shared) {
      for (const track of this.local?.getTracks() ?? []) track.stop()
    }
    this.screen?.stop()
    this.screen = null
    // Not the lent one, for the same reason the shared capture above is
    // spared: it belongs to the call, not to this leg of it.
    if (!this.shared) this.camera?.stop()
    this.camera = null
    this.pc.close()
    this.setPhase('ended')
  }
}
