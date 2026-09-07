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
import { SfuCall, type SfuParticipant } from './livekit'

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

/** Somebody in a room's call, as the room's own state says. */
export interface CallMember {
  user_id: string
  membership: { device_id?: string; expires_ts?: number }
  /**
   * What they can be reached on: `livekit` for a call held on a media
   * server, `moho.mesh` for one held between the people in it. A call with a
   * media server in it is one moho cannot join yet - the daemon refuses it
   * with an explanation rather than letting somebody sit silently in a
   * participant list.
   */
  transports?: string[]
}

/** The key that names one participant: a person on one device. */
export function memberKey(userId: string, deviceId: string): string {
  return `${userId}|${deviceId}`
}

/**
 * Whether this end is the one that calls, for a given pair.
 *
 * Both ends see each other arrive, and if both call, both answer and the call
 * collides with itself. The rule has to be a property of the pair rather than
 * of who arrived first, because "first" is not something two clients can
 * agree on - so the smaller key calls the larger, which both sides compute
 * the same way.
 */
export function shouldOffer(ownKey: string, theirKey: string): boolean {
  return ownKey < theirKey
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
  /** Publishes this end's membership of the room's call, and says who we are
   *  in it - the user and the device, since one person may be in from two. */
  joinMembership: (bufferId: string) => Promise<{
    userId: string
    deviceId: string
    roomId?: string
    /** Where the media goes, when the call is held on a media server. */
    media?: { url: string; jwt: string; identity: string } | null
    /** Whether the room is encrypted, which decides whether the media is. */
    encrypted?: boolean
  } | null>
  leaveMembership: (bufferId: string) => Promise<void>
  /** Hands this end's media key to the devices in the call. */
  sendCallKey: (bufferId: string, key: string, index: number) => Promise<void>
  /** Who the room says is in the call. */
  callMembers: (bufferId: string) => Promise<CallMember[]>
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

/** One other participant in a group call, and the connection to them. */
export interface Peer {
  key: string
  userId: string
  call: Call
  remote: MediaStream | null
}

/**
 * A call in a room, between everybody in it.
 *
 * A mesh rather than a conference: one peer connection per pair, which is
 * what Matrix has without a media server standing in the middle. That is fine
 * for the handful of people a room call usually is and would not be fine for
 * thirty - the cost is one upload stream per other participant, which is the
 * trade every meshed client makes.
 *
 * Who is in it is `m.call.member` state in the room, which is how anybody
 * learns there is a call to join at all: a group call has no invitation.
 */
export interface GroupCall {
  accountId: string
  bufferId: string
  ownKey: string
  video: boolean
  peers: Map<string, Peer>
  /** This end's camera and microphone, opened once and lent to every leg. */
  local: MediaStream | null
  /**
   * The media server, where the call is held on one.
   *
   * Set means this is an SFU call - Element's kind - and `peers` stays empty
   * because nobody is connected to anybody directly. Absent means the mesh.
   */
  sfu: SfuCall | null
  /** Who the media server says is here, for the SFU kind. */
  sfuPeople: SfuParticipant[]
  /** This end's own media key and where it is in the cycle. */
  ownKeyBase64: string
  keyIndex: number
  ownIdentity: string
  /** Who was in the call last time it was looked at, so an arrival and a
   *  departure can be told apart - they are answered differently. */
  knownMembers: Set<string>
  /** Whose media this end can actually read, by media-server identity. */
  haveKeyFrom: Set<string>
  /** The whole call's id, on every signal, so a second call in the same room
   *  is a second call rather than a crossed line. */
  confId: string
}

export class MatrixCalls {
  private surface: CallSurface
  private active: ActiveCall | null = null
  private ringing: RingingCall | null = null
  private group: GroupCall | null = null
  /** The relay list this call was set up with, so an answering leg uses the
   *  same one the offering legs did rather than asking again per invite. */
  private iceForGroup: RTCIceServer[] = []
  /** Keeps this end's membership from expiring while it is still here. */
  private heartbeat: ReturnType<typeof setInterval> | null = null

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

  get currentGroup(): GroupCall | null {
    return this.group
  }

  /**
   * Joins the room's call, starting one if nobody is in it yet.
   *
   * Joining *is* starting: publishing this end's membership is what makes a
   * call exist, and the difference between the two is only whether anybody
   * was there first.
   */
  async joinGroup(accountId: string, bufferId: string, video: boolean): Promise<void> {
    if (this.active || this.group) {
      this.surface.onError('Already in a call')
      return
    }
    const own = await this.surface.joinMembership(bufferId)
    if (!own) return
    const ownKey = memberKey(own.userId, own.deviceId)

    // A call held on a media server, which is what Element's are. Nobody
    // connects to anybody directly, so none of the mesh below runs.
    if (own.media) {
      const sfu = new SfuCall(
        {
          onParticipants: (people) => {
            if (this.group) this.group.sfuPeople = people
          },
          onConnected: (connected) => this.surface.onPhase(connected ? 'connected' : 'connecting', null),
          onError: (message) => this.surface.onError(message)
        },
        // A call in an encrypted room is encrypted; one in an open room is
        // not, and pretending otherwise would leave everybody silent.
        !!own.encrypted
      )
      this.group = {
        accountId,
        bufferId,
        ownKey,
        video,
        local: null,
        peers: new Map(),
        sfu,
        sfuPeople: [],
        ownKeyBase64: '',
        // Starts below zero so the first roll is index 0, which is where
        // every other client starts too.
        keyIndex: -1,
        ownIdentity: own.media.identity,
        knownMembers: new Set(),
        haveKeyFrom: new Set(),
        confId: `moho-conf-${own.roomId ?? bufferId}`
      }
      this.heartbeat = setInterval(() => void this.surface.joinMembership(bufferId), 30_000)
      this.surface.onPhase('connecting', null)
      try {
        // The key first, so the first frame that goes out is already
        // encrypted with something the others will be told about.
        if (sfu.encrypted) await this.rollKey(own.media.identity)
        await sfu.join(own.media.url, own.media.jwt, video)
        this.group.local = sfu.local
      } catch (e) {
        this.surface.onError(`Couldn't reach the media server: ${(e as Error).message}`)
        this.leaveGroup()
      }
      return
    }

    this.iceForGroup = await this.surface.iceServers(accountId)
    // Opened once here rather than per leg: five connections asking the
    // machine for the same camera get one capture and four refusals.
    let local: MediaStream | null = null
    try {
      local = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video
      })
    } catch {
      try {
        local = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        if (video) this.surface.onError('No camera here - joining with audio only')
      } catch (e) {
        this.surface.onError(`Couldn't open the microphone: ${(e as Error).message}`)
        await this.surface.leaveMembership(bufferId)
        return
      }
    }
    this.group = {
      accountId,
      bufferId,
      ownKey,
      video,
      local,
      peers: new Map(),
      sfu: null,
      sfuPeople: [],
      ownKeyBase64: '',
      keyIndex: -1,
      ownIdentity: '',
      knownMembers: new Set(),
      haveKeyFrom: new Set(),
      // Named for the room rather than for the buffer: each account calls the
      // same room by a different buffer id, and a conference named after one
      // of those is a conference the other end never joins.
      confId: `moho-conf-${own.roomId ?? bufferId}`
    }
    this.surface.onPhase('connecting', null)
    // Refreshed while this end is still here: a membership carries an expiry
    // so that a client which dies mid-call stops being a participant, and
    // one that is alive has to keep saying so.
    this.heartbeat = setInterval(() => void this.surface.joinMembership(bufferId), 30_000)
    await this.meet(await this.surface.callMembers(bufferId))
  }

  /**
   * Makes a new key for this end, uses it, and hands it to everybody else.
   *
   * Sixteen random bytes and an index that cycles, which is what Element
   * makes: a key provider that generates differently is one whose media
   * nobody else can read.
   *
   * Rolled again whenever somebody leaves, so that what is said after they go
   * cannot be read by them - the whole reason a call's key is per session
   * rather than per room.
   */
  private async rollKey(identity: string): Promise<void> {
    const group = this.group
    if (!group?.sfu) return
    const raw = new Uint8Array(16)
    crypto.getRandomValues(raw)
    const key = btoa(String.fromCharCode(...raw)).replace(/=+$/, '')
    group.keyIndex = (group.keyIndex + 1) % 256
    group.ownIdentity = identity
    await group.sfu.useOwnKey(identity, group.keyIndex, key)
    group.ownKeyBase64 = key
    await this.surface.sendCallKey(group.bufferId, key, group.keyIndex)
  }

  /** Somebody else's key, arriving over Matrix. */
  async takeKey(userId: string, deviceId: string, keyBase64: string, index: number): Promise<void> {
    const group = this.group
    if (!group?.sfu) return
    // The media server knows people by the identity its token service gave
    // them, which is the user and the device with a colon between.
    const identity = `${userId}:${deviceId}`
    group.haveKeyFrom.add(identity)
    await group.sfu.useTheirKey(identity, index, keyBase64)
  }

  /**
   * Names anybody whose media cannot be read, once they have had time to say.
   *
   * An encrypted call with a missing key does not fail: it connects, draws
   * everybody's tile, and is silent - which is indistinguishable from a quiet
   * room unless somebody says so. Called a little after each arrival, when a
   * key that was coming would have come.
   */
  private warnAboutSilentPeople(): void {
    const group = this.group
    if (!group?.sfu?.encrypted) return
    const unreadable = group.sfuPeople.filter((p) => !group.haveKeyFrom.has(p.key))
    if (unreadable.length === 0) return
    const who = unreadable.map((p) => p.userId).join(', ')
    this.surface.onError(
      `No key from ${who} - this call is encrypted and you will not hear them until their client sends one`
    )
  }

  /**
   * Brings the peer list into line with who the room says is in the call.
   *
   * Called on joining and on every membership change, so somebody arriving
   * gets called and somebody leaving is hung up on - which is the whole of
   * group call bookkeeping.
   */
  async meet(members: CallMember[]): Promise<void> {
    const group = this.group
    if (!group) return
    // On a media server there is nobody to meet - the server is what
    // everybody is connected to - but for an encrypted call the keys still
    // have to follow the roster: a new arrival needs the key in use, and
    // somebody leaving needs a new one, or what is said after they go is
    // still readable by them.
    if (group.sfu) {
      if (!group.sfu.encrypted) return
      const now = new Set(
        members.map((m) => `${m.user_id}:${m.membership?.device_id ?? ''}`)
      )
      const left = [...group.knownMembers].some((who) => !now.has(who))
      const arrived = [...now].some((who) => !group.knownMembers.has(who))
      group.knownMembers = now
      if (left) {
        await this.rollKey(group.ownIdentity)
      } else if (arrived && group.ownKeyBase64) {
        await this.surface.sendCallKey(group.bufferId, group.ownKeyBase64, group.keyIndex)
        // And if theirs never arrives, say so rather than leaving somebody
        // wondering why the call is quiet.
        setTimeout(() => this.warnAboutSilentPeople(), 12_000)
      }
      return
    }
    const present = new Set<string>()
    for (const member of members) {
      const key = memberKey(member.user_id, member.membership?.device_id ?? '')
      if (key === group.ownKey) continue
      present.add(key)
      if (group.peers.has(key)) continue
      // Only one end of each pair offers; the other waits for the invite.
      if (!shouldOffer(group.ownKey, key)) continue
      await this.callPeer(key, member.user_id)
    }
    // And anybody the room no longer lists has left the call, whether they
    // said so or their membership simply ran out.
    for (const [key, peer] of [...group.peers]) {
      if (present.has(key)) continue
      void peer.call.hangUp('user_hangup', true)
      group.peers.delete(key)
    }
    this.surface.onPhase(group.peers.size > 0 ? 'connected' : 'connecting', null)
  }

  /** Rings one participant of a group call. */
  private async callPeer(key: string, userId: string): Promise<void> {
    const group = this.group
    if (!group) return
    const iceServers = await this.surface.iceServers(group.accountId)
    const callId = `${group.confId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const call = this.buildPeer(group, callId, key, userId, true, iceServers)
    group.peers.set(key, { key, userId, call, remote: null })
    try {
      await call.invite(group.video)
    } catch (e) {
      this.surface.onError(`Couldn't reach ${userId}: ${(e as Error).message}`)
      group.peers.delete(key)
    }
  }

  /** Leaves the call, telling the room and everybody in it. */
  leaveGroup(): void {
    const group = this.group
    if (!group) return
    this.group = null
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    for (const peer of group.peers.values()) void peer.call.hangUp('user_hangup', true)
    if (group.sfu) {
      void group.sfu.leave()
    } else {
      // The shared capture is nobody's leg to stop, so it is stopped here.
      for (const track of group.local?.getTracks() ?? []) track.stop()
    }
    void this.surface.leaveMembership(group.bufferId)
    this.surface.onPhase('ended', null)
  }

  /**
   * One connection in the mesh.
   *
   * The same `Call` a one-to-one call uses; what differs is only that every
   * signal names the conference and the person it is for, so five people in a
   * room do not answer each other's offers.
   */
  private buildPeer(
    group: GroupCall,
    callId: string,
    theirKey: string,
    userId: string,
    outgoing: boolean,
    iceServers: RTCIceServer[]
  ): Call {
    const call: Call = new Call({
      id: callId,
      outgoing,
      iceServers,
      local: group.local,
      handlers: {
        send: (signal) => {
          const base = {
            call_id: callId,
            version: '1',
            party_id: group.ownKey,
            conf_id: group.confId,
            // Who it is for. Every signal is a room event that everybody
            // sees, so without this each offer would be answered by
            // everybody in the room at once.
            dest_session_id: theirKey
          }
          const type =
            signal.kind === 'invite'
              ? 'm.call.invite'
              : signal.kind === 'answer'
                ? 'm.call.answer'
                : signal.kind === 'candidates'
                  ? 'm.call.candidates'
                  : signal.kind === 'negotiate'
                    ? 'm.call.negotiate'
                    : 'm.call.hangup'
          this.surface.send(group.bufferId, type, { ...base, ...signal.content })
        },
        onRemoteStream: (stream) => {
          const peer = group.peers.get(theirKey)
          if (peer) peer.remote = stream
          this.surface.onPhase('connected', null)
        },
        onPhase: (phase) => {
          if (phase === 'ended') group.peers.delete(theirKey)
          this.surface.onPhase(phase === 'ended' && group.peers.size === 0 ? 'connecting' : phase, null)
        },
        onError: (message) => this.surface.onError(`${userId}: ${message}`)
      }
    })
    return call
  }

  /**
   * A signal belonging to the group call, rather than to a call of two.
   *
   * Answers with whether it was consumed, so the one-to-one path below can
   * carry on ignoring everything that is not its own.
   */
  private handleGroup(event: MatrixCallEvent): boolean {
    const group = this.group
    if (!group || group.sfu) return false
    const { content, kind, callId } = event
    if (content.conf_id !== group.confId) return false
    // Somebody else's leg of the mesh, seen because room events are seen by
    // everybody. Not ours to answer.
    if (content.dest_session_id && content.dest_session_id !== group.ownKey) return true
    const theirKey = (content.party_id as string) ?? ''
    const peer = [...group.peers.values()].find((p) => p.call.id === callId)

    if (kind === 'm.call.invite' && !peer) {
      const sdp = content.offer?.sdp as string | undefined
      if (!sdp) return true
      const call = this.buildPeer(group, callId, theirKey, event.from, false, this.iceForGroup)
      group.peers.set(theirKey, { key: theirKey, userId: event.from, call, remote: null })
      void call.accept(sdp, group.video)
      return true
    }
    if (!peer) return true
    if (kind === 'm.call.answer') {
      const sdp = content.answer?.sdp as string | undefined
      if (sdp) void peer.call.takeAnswer(sdp)
    } else if (kind === 'm.call.candidates') {
      void peer.call.addCandidates((content.candidates as RTCIceCandidateInit[] | undefined) ?? [])
    } else if (kind === 'm.call.negotiate') {
      const description = content.description as RTCSessionDescriptionInit | undefined
      if (description) void peer.call.takeNegotiation(description)
    } else if (kind === 'm.call.hangup' || kind === 'm.call.reject') {
      void peer.call.hangUp('user_hangup', false)
      group.peers.delete(peer.key)
    }
    return true
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

    // A group call's own signalling, which is addressed rather than broadcast
    // even though every event in the room is seen by everybody.
    if (content.conf_id && this.handleGroup(event)) return

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
