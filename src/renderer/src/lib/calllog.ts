/**
 * What a call did, written down where somebody can read it afterwards.
 *
 * A call fails in one of a dozen places that all look the same from the
 * window - "no picture" - and the honest answer to which one is in the
 * signalling, the descriptions each end sent, the network path that was
 * chosen and whether any media crossed it. None of that is visible in a
 * running call, and most of it is gone once the call ends, so this keeps it.
 *
 * Lines are written to the console with a `[call]` prefix; the main process
 * copies exactly those into moho.log, which outlives the window. One JSON
 * object per line, so a person can read it and a script can too.
 *
 * What it will not write: ICE credentials, DTLS fingerprints, the ufrag and
 * password lines of a description, or addresses. A log somebody sends to
 * another person to explain a fault should not also be a key to the call.
 */

const started = new Map<string, number>()

/** One thing that happened in a call. */
export function callLog(callId: string, event: string, detail: Record<string, unknown> = {}): void {
  const now = Date.now()
  if (!started.has(callId)) started.set(callId, now)
  const line = { call: callId.slice(0, 10), t: now - (started.get(callId) ?? now), event, ...detail }
  try {
    console.info(`[call] ${JSON.stringify(line)}`)
  } catch {
    /* a log line must never be the thing that breaks a call */
  }
}

/** A call is over: its clock and its counters are no longer needed. */
export function callLogEnd(callId: string): void {
  started.delete(callId)
}

/**
 * What a session description says, without what it holds.
 *
 * The parts that decide whether a picture can flow: which sections exist,
 * which way each one points, whether it was refused (port 0), and which
 * codecs it offers. `dir=inactive` or `port=0` on a video section is the
 * whole answer to "why was there no video" more often than anything deeper.
 */
export function describeSdp(sdp: string | undefined | null): Record<string, unknown> {
  if (!sdp) return { sdp: 'none' }
  const lines = sdp.split(/\r?\n/)
  const sections: Record<string, unknown>[] = []
  let current: Record<string, unknown> | null = null
  const rtpmap = new Map<string, string>()
  const candidates: Record<string, number> = {}
  let bundle = ''
  let ended = false

  const finish = (): void => {
    if (!current) return
    const payloads = (current.payloads as string[]).map((p) => rtpmap.get(p) ?? p)
    // The codec names once each: VP8 appears with its retransmission and
    // forward-error-correction companions and listing all of them is noise.
    const names = [...new Set(payloads.map((p) => p.split('/')[0]).filter((n) => !/^(rtx|red|ulpfec|flexfec-03|telephone-event|CN)$/i.test(n)))]
    current.codecs = names
    delete current.payloads
    sections.push(current)
    current = null
    rtpmap.clear()
  }

  for (const line of lines) {
    if (line.startsWith('m=')) {
      finish()
      const [kind, port, , ...payloads] = line.slice(2).split(' ')
      current = { kind, port: Number(port), payloads, dir: 'sendrecv' }
    } else if (line.startsWith('a=group:BUNDLE')) {
      bundle = line.slice('a=group:BUNDLE'.length).trim()
    } else if (line.startsWith('a=end-of-candidates')) {
      ended = true
    } else if (current) {
      const m = /^a=(sendrecv|sendonly|recvonly|inactive)$/.exec(line)
      if (m) current.dir = m[1]
      else if (line.startsWith('a=mid:')) current.mid = line.slice(6)
      else if (line.startsWith('a=msid:')) current.msid = line.slice(7).split(' ')[0].slice(0, 12)
      else if (line.startsWith('a=rtpmap:')) {
        const [pt, name] = line.slice(9).split(' ')
        rtpmap.set(pt, name)
      } else if (line.startsWith('a=candidate:')) {
        const type = /typ (\w+)/.exec(line)?.[1] ?? '?'
        candidates[type] = (candidates[type] ?? 0) + 1
      }
    }
  }
  finish()
  return {
    sections: sections.map((s) => `${s.kind}${s.mid !== undefined ? `#${s.mid}` : ''} ${s.dir}${s.port === 0 ? ' REFUSED' : ''} [${(s.codecs as string[]).join(',')}]${s.msid ? ` msid=${s.msid}` : ''}`),
    bundle,
    ...(Object.keys(candidates).length ? { candidatesInSdp: candidates, endOfCandidates: ended } : {})
  }
}

/** The relays and stun servers a call was given, by address only. */
export function describeIce(servers: RTCIceServer[]): string[] {
  return servers.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls])).map((u) => u.replace(/^(\w+:)/, '$1'))
}

interface Counters {
  bytes: number
  packets: number
  frames: number
}

const previous = new Map<string, Counters>()

/**
 * A reading of what is actually crossing the connection.
 *
 * The chosen path (a relay, or a direct route) and, per direction and kind,
 * how much has moved since the last reading. "Video track exists, no bytes in
 * five seconds" is a network or a sender fault; "bytes arriving, no frames
 * decoded" is a codec fault; "no bytes leaving" is this end. Those are the
 * distinctions a silent picture needs made.
 */
export async function sampleStats(callId: string, pc: RTCPeerConnection): Promise<Record<string, unknown>> {
  const report = await pc.getStats()
  const byId = new Map<string, any>()
  report.forEach((s) => byId.set(s.id, s))
  const out: Record<string, unknown> = {
    ice: pc.iceConnectionState,
    conn: pc.connectionState,
    signalling: pc.signalingState
  }
  report.forEach((s) => {
    if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') {
      const l = byId.get(s.localCandidateId)
      const r = byId.get(s.remoteCandidateId)
      out.path = `${l?.candidateType}/${l?.protocol} -> ${r?.candidateType}/${r?.protocol}`
      if (typeof s.currentRoundTripTime === 'number') out.rttMs = Math.round(s.currentRoundTripTime * 1000)
    }
    if (s.type === 'transport') out.dtls = s.dtlsState
    const inbound = s.type === 'inbound-rtp'
    const outbound = s.type === 'outbound-rtp'
    if (!inbound && !outbound) return
    const kind = s.kind ?? s.mediaType
    const key = `${callId}|${s.id}`
    const now: Counters = {
      bytes: inbound ? s.bytesReceived ?? 0 : s.bytesSent ?? 0,
      packets: inbound ? s.packetsReceived ?? 0 : s.packetsSent ?? 0,
      frames: inbound ? s.framesDecoded ?? 0 : s.framesEncoded ?? 0
    }
    const before = previous.get(key) ?? { bytes: 0, packets: 0, frames: 0 }
    previous.set(key, now)
    const entry: Record<string, unknown> = {
      bytes: now.bytes,
      new: now.bytes - before.bytes,
      ...(kind === 'video' ? { frames: now.frames, newFrames: now.frames - before.frames } : {})
    }
    const codec = s.codecId ? byId.get(s.codecId)?.mimeType : undefined
    if (codec) entry.codec = codec
    if (kind === 'video' && s.frameWidth) entry.size = `${s.frameWidth}x${s.frameHeight}`
    if (inbound && typeof s.packetsLost === 'number') entry.lost = s.packetsLost
    if (outbound && kind === 'video' && s.qualityLimitationReason && s.qualityLimitationReason !== 'none') {
      entry.limited = s.qualityLimitationReason
    }
    out[`${inbound ? 'in' : 'out'}.${kind}`] = entry
  })
  return out
}

/** Forget a call's counters. */
export function forgetStats(callId: string): void {
  for (const key of previous.keys()) if (key.startsWith(`${callId}|`)) previous.delete(key)
}
