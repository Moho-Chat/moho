// Two ends of a real call in one page, wired to each other.
//
// The claim under test is the one that cannot be checked by reading: that a
// camera turned on in a call already running reaches the other end, and that
// turning it off again takes it away rather than freezing it. That is
// offer/answer, a renegotiation each way and a track appearing on a stream
// somebody else owns - four things no unit test touches.
//
// Real RTCPeerConnections over loopback, and a real captured video track from
// a canvas rather than a webcam, so this runs anywhere.
import { Call } from '../../src/renderer/src/lib/webrtc'

const out: string[] = []
const say = (line: string): void => {
  out.push(line)
  const el = document.getElementById('log')!
  el.textContent = out.join('\n')
}

/** A moving picture with no camera in it. */
function fakeCamera(): MediaStream {
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 180
  const ctx = canvas.getContext('2d')!
  let frame = 0
  setInterval(() => {
    frame++
    ctx.fillStyle = `hsl(${frame % 360}, 70%, 50%)`
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }, 40)
  return (canvas as HTMLCanvasElement & { captureStream(fps: number): MediaStream }).captureStream(15)
}

/** A microphone with no microphone in it. */
function fakeMic(): MediaStream {
  const ctx = new AudioContext()
  const dest = ctx.createMediaStreamDestination()
  const osc = ctx.createOscillator()
  osc.connect(dest)
  osc.start()
  return dest.stream
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function run(): Promise<void> {
  const ice: RTCIceServer[] = []
  let a!: Call
  let b!: Call
  let bRemote: MediaStream | null = null
  let aRemote: MediaStream | null = null

  a = new Call({
    id: 'test',
    outgoing: true,
    iceServers: ice,
    local: fakeMic(),
    handlers: {
      send: (s) => void deliver('a', s),
      onRemoteStream: (st) => (aRemote = st),
      onPhase: (p) => say(`  a: ${p}`),
      onError: (m) => say(`  a error: ${m}`)
    }
  })
  b = new Call({
    id: 'test',
    outgoing: false,
    iceServers: ice,
    local: fakeMic(),
    handlers: {
      send: (s) => void deliver('b', s),
      onRemoteStream: (st) => (bRemote = st),
      onPhase: (p) => say(`  b: ${p}`),
      onError: (m) => say(`  b error: ${m}`)
    }
  })

  async function deliver(from: string, signal: { kind: string; content: Record<string, unknown> }): Promise<void> {
    const to = from === 'a' ? b : a
    const c = signal.content as Record<string, any>
    if (signal.kind === 'invite') await to.accept(c.offer.sdp, false)
    else if (signal.kind === 'answer') await to.takeAnswer(c.answer.sdp)
    else if (signal.kind === 'candidates') await to.addCandidates(c.candidates)
    else if (signal.kind === 'negotiate') await to.takeNegotiation(c.description)
  }

  const videoTracks = (s: MediaStream | null): number =>
    (s?.getVideoTracks() ?? []).filter((t) => t.readyState === 'live' && !t.muted).length

  say('placing a voice call')
  await a.invite(false)
  await wait(1500)
  say(`connected: a sees ${videoTracks(aRemote)} live video, b sees ${videoTracks(bRemote)}`)
  const startedVoiceOnly = videoTracks(aRemote) === 0 && videoTracks(bRemote) === 0

  say('a turns its camera on mid-call')
  const on = await a.setCamera(true, fakeCamera())
  await wait(2000)
  const bSeesCamera = videoTracks(bRemote)
  say(`  a.cameraOn=${on}; b now sees ${bSeesCamera} live video track(s)`)

  say('a turns it off again')
  const off = await a.setCamera(false)
  await wait(2000)
  const bSeesAfter = videoTracks(bRemote)
  say(`  a.cameraOn=${a.cameraOn} (returned ${off}); b now sees ${bSeesAfter}`)

  say('b turns its camera on, the other direction')
  await b.setCamera(true, fakeCamera())
  await wait(2000)
  const aSeesCamera = videoTracks(aRemote)
  say(`  a now sees ${aSeesCamera} live video track(s)`)

  const verdict =
    startedVoiceOnly && bSeesCamera === 1 && bSeesAfter === 0 && aSeesCamera === 1 ? 'PASS' : 'FAIL'
  say(`\nVERDICT ${verdict}`)
  document.title = `callcheck ${verdict}`
  ;(window as unknown as { verdict: string }).verdict = verdict

  await a.hangUp(undefined, false)
  await b.hangUp(undefined, false)
}

void run().catch((e) => {
  say(`threw: ${(e as Error).message}`)
  document.title = 'callcheck FAIL'
  ;(window as unknown as { verdict: string }).verdict = 'FAIL'
})
