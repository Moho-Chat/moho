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
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteTrackPublication
} from 'livekit-client'

/** One person on the media server, and what they are sending. */
export interface SfuParticipant {
  /** LiveKit's own identity, which the JWT service sets to `user:device`. */
  key: string
  userId: string
  stream: MediaStream
  hasVideo: boolean
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
  /** This end's own capture, so the tile shows what is being sent. */
  local: MediaStream | null = null

  constructor(handlers: SfuHandlers) {
    this.handlers = handlers
    this.room = new Room({
      // Let LiveKit decide what to send as the window and the connection
      // change: it can see the packet loss and this cannot.
      adaptiveStream: true,
      dynacast: true
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
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        // Being on the server is what connected means here, whether or not
        // anybody else has arrived - unlike the mesh, where there is nothing
        // to be connected *to* until somebody answers.
        this.handlers.onConnected(state === ConnectionState.Connected)
        announce()
      })
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

  /** Shares a screen, or stops. Returns whether one is being shared. */
  async toggleScreen(): Promise<boolean> {
    const on = this.room.localParticipant.isScreenShareEnabled
    await this.room.localParticipant.setScreenShareEnabled(!on)
    this.local = this.ownStream()
    return !on
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
