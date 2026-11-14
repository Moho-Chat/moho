/**
 * Signal calls, run by RingRTC - Signal's own call engine (its WebRTC, its key exchange, the audio devices) - in this
 * process, as Signal Desktop runs it. The daemon is what is connected to Signal: it hands over every call message as it
 * arrived (`signalCallMessage`, with the identity keys RingRTC binds a call to), sends what RingRTC asks to send
 * (`signalSendCallMessage`), and fetches Signal's relays (`signalCallSettings`). This file is the glue, and what the
 * windows are told: a call's state as `signalCall` events, the other side's picture as frames.
 *
 * RingRTC is loaded the first time it is wanted. Without it (a build that lacks its native library) nothing here is
 * offered, and a Signal call rings as one answered on the phone, as before.
 *
 * One call at a time, as RingRTC has it.
 */
import { log } from './log'

type RingrtcModule = typeof import('@signalapp/ringrtc')
type Call = import('@signalapp/ringrtc').Call
type GroupCall = import('@signalapp/ringrtc').GroupCall
type CallingMessage = import('@signalapp/ringrtc').CallingMessage

/** What the daemon says about a call message (see nobilis `signal::calls::hand_to_app`). */
interface Arrived {
  accountId: string
  ownAci: string
  localDeviceId: number
  sender: string
  senderDeviceId: number
  ageSec: number
  receivedAtMs: number
  senderIdentityKey: string
  receiverIdentityKey: string
  bufferId?: string | null
  message: WireMessage
}

/** A call message as the daemon writes it: ids as text (they are 64-bit), bytes as base64. */
export interface WireMessage {
  offer?: { callId: string; type: number; opaque?: string }
  answer?: { callId: string; opaque?: string }
  iceCandidates?: { callId: string; opaque?: string }[]
  busy?: { callId: string }
  hangup?: { callId: string; type: number; deviceId: number }
  opaque?: { data?: string; urgency?: number }
  destinationDeviceId?: number
}

/** What the windows are told about the call. */
export interface SignalCallState {
  accountId: string
  bufferId: string | null
  remote: string
  callId: string
  incoming: boolean
  video: boolean
  state: 'ringing' | 'connecting' | 'connected' | 'reconnecting' | 'ended'
  remoteAudio: boolean
  remoteVideo: boolean
  audioMuted: boolean
  videoMuted: boolean
  /** This side's screen is what is being sent as the picture. */
  sharing?: boolean
  /** Why it ended, in words, once it has. */
  ended?: string
}

/** A group call, as the windows are told it. */
export interface SignalGroupCallState {
  accountId: string
  bufferId: string
  /** not joined, joining, waiting to be let in, joined */
  joinState: 'idle' | 'joining' | 'pending' | 'joined' | 'ended'
  connected: boolean
  participants: { demuxId: number; userId: string; audioMuted: boolean; videoMuted: boolean }[]
  audioMuted: boolean
  videoMuted: boolean
  sharing: boolean
  ended?: string
}

/** What the daemon gives for joining a group's call (nobilis `signal::calls::group_info`). */
interface GroupInfo {
  accountId: string
  bufferId: string
  groupId: string
  proof: string
  members: { userId: string; cipher: string }[]
  sfuUrl: string
  ownAci: string
}

/** Sixteen bytes as a UUID's text. */
export function uuidText(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export interface SignalCallsDeps {
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>
  /** To every window, as a daemon event would be. */
  emit: (event: string, data: unknown) => void
  /** The other side's picture (a group call's: one participant's, by demux id), to every window. */
  frame: (width: number, height: number, rgba: Uint8Array, demuxId?: number) => void
  /** Loads RingRTC; replaced in tests. */
  load?: () => RingrtcModule
}

const bytes = (b64: string | undefined): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(b64 ?? '', 'base64'))
const b64 = (data: Uint8Array | undefined): string | undefined => (data ? Buffer.from(data).toString('base64') : undefined)

/** A UUID's sixteen bytes. */
export function uuidBytes(uuid: string): Uint8Array<ArrayBuffer> {
  const hex = uuid.replace(/-/g, '')
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error(`not a UUID: ${uuid}`)
  return new Uint8Array(Buffer.from(hex, 'hex'))
}

/** The daemon's message as RingRTC's. */
export function toRingrtc(rtc: RingrtcModule, wire: WireMessage): CallingMessage {
  const m = new rtc.CallingMessage()
  if (wire.offer) m.offer = new rtc.OfferMessage(BigInt(wire.offer.callId), wire.offer.type, bytes(wire.offer.opaque))
  if (wire.answer) m.answer = new rtc.AnswerMessage(BigInt(wire.answer.callId), bytes(wire.answer.opaque))
  if (wire.iceCandidates?.length) m.iceCandidates = wire.iceCandidates.map((c) => new rtc.IceCandidateMessage(BigInt(c.callId), bytes(c.opaque)))
  if (wire.busy) m.busy = new rtc.BusyMessage(BigInt(wire.busy.callId))
  if (wire.hangup) m.hangup = new rtc.HangupMessage(BigInt(wire.hangup.callId), wire.hangup.type, wire.hangup.deviceId)
  if (wire.opaque) {
    m.opaque = new rtc.OpaqueMessage()
    m.opaque.data = bytes(wire.opaque.data)
  }
  if (wire.destinationDeviceId) m.destinationDeviceId = wire.destinationDeviceId
  return m
}

/** RingRTC's message as the daemon takes it. */
export function fromRingrtc(m: CallingMessage, urgency?: number): WireMessage {
  const wire: WireMessage = {}
  if (m.offer) wire.offer = { callId: m.offer.callId.toString(), type: m.offer.type, opaque: b64(m.offer.opaque) }
  if (m.answer) wire.answer = { callId: m.answer.callId.toString(), opaque: b64(m.answer.opaque) }
  if (m.iceCandidates?.length) wire.iceCandidates = m.iceCandidates.map((c) => ({ callId: c.callId.toString(), opaque: b64(c.opaque) }))
  if (m.busy) wire.busy = { callId: m.busy.callId.toString() }
  if (m.hangup) wire.hangup = { callId: m.hangup.callId.toString(), type: m.hangup.type, deviceId: m.hangup.deviceId }
  if (m.opaque) wire.opaque = { data: b64(m.opaque.data), urgency }
  if (m.destinationDeviceId) wire.destinationDeviceId = m.destinationDeviceId
  return wire
}

/** Why a call ended, in words. */
function endedWords(rtc: RingrtcModule, reason: number | undefined): string {
  const R = rtc.CallEndReason
  switch (reason) {
    case R.LocalHangup:
      return 'You hung up'
    case R.RemoteHangup:
      return 'They hung up'
    case R.RemoteHangupAccepted:
      return 'Answered on another device'
    case R.RemoteHangupDeclined:
      return 'Declined on another device'
    case R.RemoteHangupBusy:
    case R.RemoteBusy:
      return 'They are busy'
    case R.Timeout:
      return 'Nobody answered'
    case R.RemoteHangupNeedPermission:
      return 'They have to accept your message request first'
    case R.ConnectionFailure:
    case R.IceFailedWhileConnecting:
    case R.IceFailedAfterConnected:
      return 'The connection failed'
    case R.SignalingFailure:
      return 'Signal did not take the call'
    default:
      return 'The call ended'
  }
}

export class SignalCalls {
  private rtc: RingrtcModule | null | undefined
  private call: Call | null = null
  private info: SignalCallState | null = null
  private frames: NodeJS.Timeout | null = null
  private frameBuffer = new Uint8Array(1280 * 720 * 4)
  /** Whether the call that is on ever connected: what the call logs are told when it ends. */
  private connected = false
  /** The account last heard from or called on: who sends a group call's messages when nothing else says. */
  private account: string | null = null
  private group: { info: GroupInfo; call: GroupCall; state: SignalGroupCallState } | null = null
  private groupFrames: NodeJS.Timeout | null = null

  constructor(private readonly deps: SignalCallsDeps) {}

  /** RingRTC, loaded and wired the first time; null when this build cannot load it. */
  private ringrtc(): RingrtcModule | null {
    if (this.rtc !== undefined) return this.rtc
    try {
      const rtc = this.deps.load ? this.deps.load() : (require('@signalapp/ringrtc') as RingrtcModule)
      this.wire(rtc)
      this.rtc = rtc
      log.info('[signal-calls] RingRTC loaded')
    } catch (e) {
      log.warn('[signal-calls] RingRTC is not available, Signal calls are answered on the phone:', (e as Error).message)
      this.rtc = null
    }
    return this.rtc
  }

  /** Whether calls can be made and taken here. */
  available(): boolean {
    return this.ringrtc() !== null
  }

  current(): SignalCallState | null {
    return this.info
  }

  private wire(rtc: RingrtcModule): void {
    const R = rtc.RingRTC
    R.handleOutgoingSignaling = async (remoteUserId, message) => {
      if (!this.info) return false
      try {
        await this.deps.request('signalSendCallMessage', { accountId: this.info.accountId, to: remoteUserId, message: fromRingrtc(message) })
        return true
      } catch (e) {
        log.warn('[signal-calls] a call message was not sent:', (e as Error).message)
        return false
      }
    }
    R.handleIncomingCall = async (call) => {
      if (!this.info || this.info.remote !== call.remoteUserId) return false
      this.track(call)
      this.update({ callId: call.callId.toString(), video: call.isVideoCall, state: 'ringing', incoming: true })
      return true
    }
    R.handleStartCall = async (call) => {
      if (!this.info) return false
      try {
        const settings = (await this.deps.request('signalCallSettings', { accountId: this.info.accountId })) as { iceServers: { username?: string; password?: string; urls: string[]; hostname?: string }[] }
        R.proceed(call.callId, { iceServers: settings.iceServers, hideIp: false, dataMode: rtc.DataMode.Normal, audioLevelsIntervalMillis: 200 })
        return true
      } catch (e) {
        this.update({ state: 'ended', ended: (e as Error).message })
        return false
      }
    }
    // An offer RingRTC turned away (too old, or while busy): no call is coming from it.
    R.handleRejectedIncomingCallRequest = (callId) => {
      if (this.info && !this.call && this.info.callId === callId.toString()) this.info = null
    }
    // Group calls: their rings go to the group's members, and the call server is reached over HTTP done here.
    R.handleSendCallMessageToGroup = (groupId, message, urgency, overrideRecipients) => {
      const accountId = this.group?.info.accountId ?? this.account
      if (!accountId) return
      void this.deps
        .request('signalSendGroupCallMessage', {
          accountId,
          groupId: Buffer.from(groupId).toString('base64'),
          message: { opaque: { data: Buffer.from(message).toString('base64'), urgency } },
          recipients: overrideRecipients.map(uuidText)
        })
        .catch((e: Error) => log.warn('[signal-calls] a group call message was not sent:', e.message))
    }
    R.handleSendCallMessage = (recipientUuid, message, urgency) => {
      const accountId = this.group?.info.accountId ?? this.info?.accountId ?? this.account
      if (!accountId) return
      void this.deps
        .request('signalSendCallMessage', { accountId, to: uuidText(recipientUuid), message: { opaque: { data: Buffer.from(message).toString('base64'), urgency } } })
        .catch((e: Error) => log.warn('[signal-calls] a call message was not sent:', e.message))
    }
    R.handleSendHttpRequest = (requestId, url, method, headers, body) => {
      const verb = ['GET', 'PUT', 'POST', 'DELETE'][method] ?? 'GET'
      void fetch(url, { method: verb, headers, body: body ? Buffer.from(body) : undefined })
        .then(async (res) => R.receivedHttpResponse(requestId, res.status, new Uint8Array(await res.arrayBuffer())))
        .catch((e: Error) => R.httpRequestFailed(requestId, e.message))
    }
    R.handleGroupCallRingUpdate = (groupId, ringId, sender, update) => {
      const accountId = this.account
      if (!accountId) return
      this.deps.emit('signalGroupRing', { accountId, groupId: Buffer.from(groupId).toString('base64'), ringId: ringId.toString(), sender: uuidText(sender), update })
    }
    R.handleLogMessage = (level, fileName, line, message) => {
      if (level <= rtc.CallLogLevel.Warn) log.warn(`[ringrtc] ${fileName}:${line} ${message}`)
    }
  }

  private track(call: Call): void {
    const rtc = this.rtc
    if (!rtc) return
    this.call = call
    call.handleStateChanged = () => {
      const S = rtc.CallState
      const state = call.state
      if (state === S.Ended) {
        const info = this.info
        if (info) {
          // The phone and the account's other devices put it in their call logs, and the conversation says it.
          void this.deps
            .request('signalCallEnded', { accountId: info.accountId, remote: info.remote, callId: call.callId.toString(), video: info.video, incoming: info.incoming, accepted: this.connected })
            .catch((e: Error) => log.warn('[signal-calls] the call log was not shared:', e.message))
        }
        this.update({ state: 'ended', ended: endedWords(rtc, call.endedReason) })
        this.stopFrames()
        this.call = null
        this.connected = false
        return
      }
      if (state === S.Accepted) this.connected = true
      this.update({ state: state === S.Ringing ? 'ringing' : state === S.Accepted ? 'connected' : state === S.Reconnecting ? 'reconnecting' : 'connecting' })
      if (state === S.Accepted) this.startFrames()
    }
    call.handleRemoteAudioEnabled = () => this.update({ remoteAudio: call.remoteAudioEnabled })
    call.handleRemoteVideoEnabled = () => this.update({ remoteVideo: call.remoteVideoEnabled })
  }

  private update(change: Partial<SignalCallState>): void {
    if (!this.info) return
    this.info = { ...this.info, ...change }
    this.deps.emit('signalCall', this.info)
    if (this.info.state === 'ended') this.info = null
  }

  /** The other side's picture, while there is a call: polled, as RingRTC hands frames to whoever asks. */
  private startFrames(): void {
    if (this.frames) return
    this.frames = setInterval(() => {
      const call = this.call
      if (!call || !this.info?.remoteVideo) return
      const size = call.receiveVideoFrame(this.frameBuffer, 1280, 720)
      if (!size) return
      const [width, height] = size
      this.deps.frame(width, height, this.frameBuffer.slice(0, width * height * 4))
    }, 66)
  }

  private stopFrames(): void {
    if (this.frames) clearInterval(this.frames)
    this.frames = null
  }

  /** A call message the daemon handed over. */
  arrived(a: Arrived): void {
    const rtc = this.ringrtc()
    if (!rtc) return
    // Somebody new calling while a call is on is RingRTC's to answer as busy; it needs to know who this is.
    if (!this.info && a.message.offer) {
      this.info = {
        accountId: a.accountId,
        bufferId: a.bufferId ?? null,
        remote: a.sender,
        callId: a.message.offer.callId,
        incoming: true,
        video: a.message.offer.type === 1,
        state: 'ringing',
        remoteAudio: true,
        remoteVideo: false,
        audioMuted: false,
        videoMuted: a.message.offer.type !== 1
      }
      // An offer that never became a call (not for this device, say) is not left standing in the way of the next.
      const id = a.message.offer.callId
      setTimeout(() => {
        if (this.info && !this.call && this.info.callId === id) this.info = null
      }, 10_000).unref?.()
    }
    this.account = a.accountId
    rtc.RingRTC.setSelfUuid(uuidBytes(a.ownAci))
    rtc.RingRTC.handleCallingMessage(toRingrtc(rtc, a.message), {
      remoteUserId: a.sender,
      remoteUuid: uuidBytes(a.sender),
      remoteDeviceId: a.senderDeviceId,
      localDeviceId: a.localDeviceId,
      ageSec: a.ageSec,
      receivedAtCounter: 0,
      receivedAtDate: a.receivedAtMs,
      senderIdentityKey: bytes(a.senderIdentityKey),
      receiverIdentityKey: bytes(a.receiverIdentityKey)
    })
  }

  /** Calls somebody (their ACI) from an account. */
  async start(accountId: string, bufferId: string, remote: string, video: boolean): Promise<void> {
    const rtc = this.ringrtc()
    if (!rtc) throw new Error('Signal calls are not available in this build')
    if (this.info) throw new Error('There is a call already')
    const settings = (await this.deps.request('signalCallSettings', { accountId })) as { ownAci: string; deviceId: number }
    this.info = { accountId, bufferId, remote, callId: '', incoming: false, video, state: 'connecting', remoteAudio: true, remoteVideo: false, audioMuted: false, videoMuted: !video }
    rtc.RingRTC.setSelfUuid(uuidBytes(settings.ownAci))
    const call = rtc.RingRTC.startOutgoingCall(remote, video, settings.deviceId)
    this.track(call)
    this.update({ callId: call.callId.toString() })
  }

  accept(video: boolean): void {
    const call = this.call
    if (!call || !this.info) return
    call.accept()
    call.setOutgoingAudioMuted(false)
    call.setOutgoingVideoMuted(!video)
    this.update({ state: 'connecting', videoMuted: !video })
  }

  decline(): void {
    this.call?.decline()
  }

  hangup(): void {
    this.call?.hangup()
  }

  mute(audio: boolean | undefined, video: boolean | undefined): void {
    const call = this.call
    if (!call) return
    if (audio !== undefined) call.setOutgoingAudioMuted(audio)
    if (video !== undefined) call.setOutgoingVideoMuted(video)
    this.update({ ...(audio !== undefined ? { audioMuted: audio } : {}), ...(video !== undefined ? { videoMuted: video } : {}) })
  }

  /** Sends this side's screen as the picture instead of the camera, or stops. */
  share(on: boolean): void {
    const call = this.call
    if (!call || !this.info) return
    call.setOutgoingVideoIsScreenShare(on)
    // The picture is on while the screen is shared, whatever the camera was.
    call.setOutgoingVideoMuted(!on && this.info.videoMuted)
    this.update({ sharing: on })
  }

  // -- group calls --------------------------------------------------------------------------------------------------

  currentGroup(): SignalGroupCallState | null {
    return this.group?.state ?? null
  }

  private updateGroup(change: Partial<SignalGroupCallState>): void {
    if (!this.group) return
    this.group.state = { ...this.group.state, ...change }
    this.deps.emit('signalGroupCall', this.group.state)
  }

  /** Joins (or starts) a group's call; `ring` rings its members, as starting one from the phone does. */
  async joinGroup(bufferId: string, video: boolean, ring: boolean): Promise<void> {
    const rtc = this.ringrtc()
    if (!rtc) throw new Error('Signal calls are not available in this build')
    if (this.group || this.info) throw new Error('There is a call already')
    const info = (await this.deps.request('signalGroupCallInfo', { bufferId })) as GroupInfo
    this.account = info.accountId
    rtc.RingRTC.setSelfUuid(uuidBytes(info.ownAci))
    const members = info.members.map((m) => new rtc.GroupMemberInfo(bytes(m.userId), bytes(m.cipher)))
    const call = rtc.RingRTC.getGroupCall(bytes(info.groupId), info.sfuUrl, new Uint8Array(0), 200, undefined, undefined, {
      requestMembershipProof: (g) => g.setMembershipProof(bytes(info.proof)),
      requestGroupMembers: (g) => g.setGroupMembers(members),
      onLocalDeviceStateChanged: (g) => {
        const local = g.getLocalDeviceState()
        const J = rtc.JoinState
        this.updateGroup({
          joinState: local.joinState === J.Joined ? 'joined' : local.joinState === J.Pending ? 'pending' : local.joinState === J.Joining ? 'joining' : 'idle',
          connected: local.connectionState === rtc.ConnectionState.Connected,
          audioMuted: local.audioMuted,
          videoMuted: local.videoMuted
        })
      },
      onRemoteDeviceStatesChanged: (g) => {
        const remote = g.getRemoteDeviceStates() ?? []
        this.updateGroup({
          participants: remote.map((d) => ({ demuxId: d.demuxId, userId: uuidText(d.userId), audioMuted: !!d.audioMuted, videoMuted: d.videoMuted !== false }))
        })
        g.requestVideo(remote.map((d) => new rtc.VideoRequest(d.demuxId, 640, 360, 30)), 0)
      },
      onAudioLevels: () => {},
      onLowBandwidthForVideo: () => {},
      onReactions: () => {},
      onRaisedHands: () => {},
      onPeekChanged: () => {},
      onEnded: (_g, reason) => this.groupEnded(endedWords(rtc, reason)),
      onSpeechEvent: () => {},
      onRemoteMute: (g) => {
        g.setOutgoingAudioMuted(true)
        this.updateGroup({ audioMuted: true })
      },
      onObservedRemoteMute: () => {}
    })
    if (!call) throw new Error('The group call could not be started')
    this.group = {
      info,
      call,
      state: { accountId: info.accountId, bufferId, joinState: 'joining', connected: false, participants: [], audioMuted: false, videoMuted: !video, sharing: false }
    }
    this.updateGroup({})
    call.connect()
    call.setOutgoingAudioMuted(false)
    call.setOutgoingVideoMuted(!video)
    call.join()
    if (ring) call.ringAll()
    this.startGroupFrames()
  }

  private groupEnded(words: string): void {
    if (!this.group) return
    if (this.groupFrames) clearInterval(this.groupFrames)
    this.groupFrames = null
    this.updateGroup({ joinState: 'ended', ended: words })
    this.group = null
  }

  leaveGroup(): void {
    const g = this.group
    if (!g) return
    g.call.leave()
    g.call.disconnect()
    this.groupEnded('You left the call')
  }

  muteGroup(audio: boolean | undefined, video: boolean | undefined): void {
    const g = this.group
    if (!g) return
    if (audio !== undefined) g.call.setOutgoingAudioMuted(audio)
    if (video !== undefined) g.call.setOutgoingVideoMuted(video)
    this.updateGroup({ ...(audio !== undefined ? { audioMuted: audio } : {}), ...(video !== undefined ? { videoMuted: video } : {}) })
  }

  shareGroup(on: boolean): void {
    const g = this.group
    if (!g) return
    g.call.setOutgoingVideoIsScreenShare(on)
    g.call.setPresenting(on)
    g.call.setOutgoingVideoMuted(!on && g.state.videoMuted)
    this.updateGroup({ sharing: on })
  }

  /** Turns down a group's ring here (and on the account's other devices, which RingRTC tells). */
  declineGroupRing(groupId: string, ringId: string): void {
    const rtc = this.ringrtc()
    if (!rtc) return
    rtc.RingRTC.cancelGroupRing(bytes(groupId), BigInt(ringId), rtc.RingCancelReason.DeclinedByUser)
  }

  /** Each participant's picture, polled as RingRTC hands frames to whoever asks. */
  private startGroupFrames(): void {
    if (this.groupFrames) return
    this.groupFrames = setInterval(() => {
      const g = this.group
      if (!g) return
      for (const p of g.state.participants) {
        if (p.videoMuted) continue
        const size = g.call.getVideoSource(p.demuxId).receiveVideoFrame(this.frameBuffer, 640, 360)
        if (!size) continue
        const [width, height] = size
        this.deps.frame(width, height, this.frameBuffer.slice(0, width * height * 4), p.demuxId)
      }
    }, 100)
  }

  /** A frame of this side's camera or screen, from the window. */
  sendFrame(width: number, height: number, rgba: Uint8Array): void {
    const rtc = this.rtc
    const g = this.group
    if (rtc && g) {
      if (!g.state.videoMuted || g.state.sharing) g.call.sendVideoFrame(width, height, rtc.VideoPixelFormatEnum.Rgba, new Uint8Array(rgba))
      return
    }
    const call = this.call
    if (!rtc || !call || (this.info?.videoMuted && !this.info.sharing)) return
    call.sendVideoFrame(width, height, rtc.VideoPixelFormatEnum.Rgba, new Uint8Array(rgba))
  }
}
