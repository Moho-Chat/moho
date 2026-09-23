/**
 * A call held on a media server, which is what Element's calls are.
 *
 * The mesh beside this connects everybody to everybody: fine for a handful of
 * people, and nothing any other Matrix client speaks. Element Call sends one
 * stream up to a LiveKit SFU and gets everybody else's back down, which costs
 * one upload however many people are in the room - and, more to the point, is
 * where the people using Element already are.
 *
 * moho is a LiveKit client here and nothing more: the daemon has already
 * turned this account's identity into a URL and a token (see calls.rs), and
 * what happens after that is the SFU's own protocol rather than Matrix's.
 *
 * Deliberately not a second implementation of the tiles. It hands back the
 * same shape the mesh does - a list of people and their streams - so the grid,
 * the speaking ring and the corner view do not know which kind of call they
 * are drawing.
 */

import {
  BaseKeyProvider,
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteTrackPublication
} from 'livekit-client'
import E2EEWorker from 'livekit-client/e2ee-worker?worker'

/** One person on the media server, and what they are sending. */
export interface SfuParticipant {
  /** LiveKit's own identity, which the JWT service sets to `user:device`. */
  key: string
  userId: string
  stream: MediaStream
  hasVideo: boolean
}

/**
 * The keys a call's media is encrypted with, as Matrix hands them around.
 *
 * The media server forwards frames it cannot read: each participant makes a
 * key, sends it to the devices in the call over Matrix, and everybody's
 * player is told which key belongs to which participant. This is the provider
 * LiveKit asks for those keys, filled from the daemon's side of that
 * exchange - see calls.rs.
 *
 * The window sizes are Element's own, because a key provider that ratchets
 * differently from the other clients in a call is a key provider that decodes
 * nothing.
 */
class MatrixKeyProvider extends BaseKeyProvider {
  constructor() {
    super({ ratchetWindowSize: 10, keyringSize: 256 })
  }

  /** Somebody's key, for the participant the media server knows them as. */
  async setParticipantKey(identity: string, index: number, keyBase64: string): Promise<void> {
    const raw = Uint8Array.from(atob(keyBase64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
    // Imported as HKDF material rather than as a key: LiveKit derives the
    // cipher key from it, and Element hands it the same material, which is
    // what makes the two agree.
    const material = await crypto.subtle.importKey('raw', raw as BufferSource, 'HKDF', false, [
      'deriveBits',
      'deriveKey'
    ])
    this.onSetEncryptionKey(material, identity, index)
  }
}

export interface SfuHandlers {
  /** Somebody joined, left, or started sending something different. */
  onParticipants: (people: SfuParticipant[]) => void
  /** Whether this end is on the server, which is what "connected" means for
   *  a call held on one - being alone in it is still being in it. */
  onConnected: (connected: boolean) => void
  onError: (message: string) => void
}

/**
 * The Matrix user behind a LiveKit identity.
 *
 * The JWT service sets the identity to `@user:server:DEVICEID`, so the user id
 * is everything up to the last colon - which is not the same as splitting on
 * the first, because a Matrix id has a colon in it already.
 */
export function userFromIdentity(identity: string): string {
  const cut = identity.lastIndexOf(':')
  return cut > 0 ? identity.slice(0, cut) : identity
}

export class SfuCall {
  private room: Room
  private handlers: SfuHandlers
  /** Where the keys go, for an encrypted call. Absent means one in the clear. */
  private keys: MatrixKeyProvider | null = null
  /** This end's own capture, so the tile shows what is being sent. */
  local: MediaStream | null = null

  constructor(handlers: SfuHandlers, encrypted: boolean) {
    this.handlers = handlers
    this.keys = encrypted ? new MatrixKeyProvider() : null
    this.room = new Room({
      // Let LiveKit decide what to send as the window and the connection
      // change: it can see the packet loss and this cannot.
      adaptiveStream: true,
      dynacast: true,
      // A call in an encrypted room is encrypted between the people in it,
      // with the server forwarding frames it cannot read. The worker is where
      // the frames are actually enciphered - the browser will only let a
      // transform touch them off the main thread.
      ...(this.keys
        ? { e2ee: { keyProvider: this.keys as unknown as BaseKeyProvider, worker: new E2EEWorker() } }
        : {})
    })
    const announce = (): void => this.handlers.onParticipants(this.people())
    this.room
      .on(RoomEvent.TrackSubscribed, announce)
      .on(RoomEvent.TrackUnsubscribed, announce)
      .on(RoomEvent.ParticipantConnected, announce)
      .on(RoomEvent.ParticipantDisconnected, announce)
      .on(RoomEvent.Disconnected, () => {
        this.handlers.onParticipants([])
        this.handlers.onConnected(false)
      })
      // Frames arriving that cannot be read. In an encrypted call that means
      // somebody's key never got here, or theirs and ours disagree - which
      // looks exactly like a working call with silence in it, so it is worth
      // saying rather than leaving people to wonder why nobody is talking.
      .on(RoomEvent.EncryptionError, (error) =>
        this.handlers.onError(`Cannot read what somebody in the call is sending: ${error.message}`)
      )
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        // Being on the server is what connected means here, whether or not
        // anybody else has arrived - unlike the mesh, where there is nothing
        // to be connected *to* until somebody answers.
        this.handlers.onConnected(state === ConnectionState.Connected)
        announce()
      })
  }

  /** Whether this call's media is encrypted end to end. */
  get encrypted(): boolean {
    return this.keys !== null
  }

  /** This end's own key, which everybody else has to be told about. */
  async useOwnKey(identity: string, index: number, keyBase64: string): Promise<void> {
    if (!this.keys) return
    await this.keys.setParticipantKey(identity, index, keyBase64)
    await this.room.setE2EEEnabled(true)
  }

  /** Somebody else's key, as it arrives over Matrix. */
  async useTheirKey(identity: string, index: number, keyBase64: string): Promise<void> {
    await this.keys?.setParticipantKey(identity, index, keyBase64)
  }

  /** Joins the media server and starts sending. */
  async join(url: string, token: string, video: boolean): Promise<void> {
    await this.room.connect(url, token)
    try {
      await this.room.localParticipant.setMicrophoneEnabled(true)
      if (video) await this.room.localParticipant.setCameraEnabled(true)
    } catch (e) {
      // A machine with no camera still belongs in the call.
      this.handlers.onError(`Couldn't open the camera: ${(e as Error).message}`)
      await this.room.localParticipant.setMicrophoneEnabled(true).catch(() => {})
    }
    this.local = this.ownStream()
    this.handlers.onConnected(this.room.state === ConnectionState.Connected)
    this.handlers.onParticipants(this.people())
  }

  /** Everybody else, with whatever they are currently sending. */
  people(): SfuParticipant[] {
    const out: SfuParticipant[] = []
    for (const participant of this.room.remoteParticipants.values()) {
      const stream = new MediaStream()
      let hasVideo = false
      for (const publication of participant.trackPublications.values()) {
        const track = (publication as RemoteTrackPublication).track as RemoteTrack | undefined
        if (!track?.mediaStreamTrack) continue
        stream.addTrack(track.mediaStreamTrack)
        if (track.kind === Track.Kind.Video) hasVideo = true
      }
      if (stream.getTracks().length === 0) continue
      out.push({
        key: participant.identity,
        userId: userFromIdentity(participant.identity),
        stream,
        hasVideo
      })
    }
    return out
  }

  /** What this end is sending, for its own tile. */
  private ownStream(): MediaStream | null {
    const stream = new MediaStream()
    for (const publication of this.room.localParticipant.trackPublications.values()) {
      const track = publication.track?.mediaStreamTrack
      if (track) stream.addTrack(track)
    }
    return stream.getTracks().length > 0 ? stream : null
  }

  /** Silences the microphone, or lets it speak again. Returns muted. */
  async toggleMute(): Promise<boolean> {
    const on = this.room.localParticipant.isMicrophoneEnabled
    await this.room.localParticipant.setMicrophoneEnabled(!on)
    return on
  }

  /**
   * Turns the camera on, or off. Returns whether it is on.
   *
   * A call could be *joined* with video and never changed after - the camera
   * was a decision made once, before anybody was on screen, which is the
   * moment nobody knows yet whether they want to be seen.
   */
  async toggleCamera(): Promise<boolean> {
    const on = this.room.localParticipant.isCameraEnabled
    await this.room.localParticipant.setCameraEnabled(!on)
    // The local tile shows what this end is sending, so it has to be rebuilt
    // when that changes - the same reason toggleScreen does it.
    this.local = this.ownStream()
    return !on
  }

  /** Whether this end is sending a picture at all. */
  get cameraOn(): boolean {
    return this.room.localParticipant.isCameraEnabled
  }

  /** Shares a screen, or stops. Returns whether one is being shared. */
  async toggleScreen(): Promise<boolean> {
    const on = this.room.localParticipant.isScreenShareEnabled
    await this.room.localParticipant.setScreenShareEnabled(!on)
    this.local = this.ownStream()
    return !on
  }

  /**
   * What the connection says is actually arriving, per participant.
   *
   * Tracks existing is not the same as tracks being readable: an undecodable
   * stream is still a stream, with silence in it. The receiver's own counters
   * are what tell the two apart.
   */
  async arriving(): Promise<{ identity: string; packets: number; samples: number }[]> {
    const out: { identity: string; packets: number; samples: number }[] = []
    for (const participant of this.room.remoteParticipants.values()) {
      let packets = 0
      let samples = 0
      for (const publication of participant.trackPublications.values()) {
        const receiver = (publication as RemoteTrackPublication).track?.receiver
        if (!receiver) continue
        const stats = await receiver.getStats()
        stats.forEach((report) => {
          if (report.type !== 'inbound-rtp') return
          packets += (report as { packetsReceived?: number }).packetsReceived ?? 0
          samples += (report as { totalSamplesReceived?: number }).totalSamplesReceived ?? 0
        })
      }
      out.push({ identity: participant.identity, packets, samples })
    }
    return out
  }

  /** Leaves, letting go of the camera and the microphone. */
  async leave(): Promise<void> {
    await this.room.disconnect()
    this.local = null
  }

  /**
   * Whether the media server is telling us it cannot read what is arriving.
   *
   * Element encrypts a call's media per sender in an encrypted room, with the
   * keys shared over Matrix. moho does not do that yet, so a call in such a
   * room is one where everybody is connected and nobody can hear anybody -
   * which is worth saying rather than leaving people to wonder.
   */
  get anyoneUndecodable(): boolean {
    return [...this.room.remoteParticipants.values()].some((p) =>
      [...p.trackPublications.values()].some((pub) => pub.isEncrypted && !pub.isSubscribed)
    )
  }
}
