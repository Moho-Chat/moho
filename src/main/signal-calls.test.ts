import { describe, expect, it } from 'vitest'
import { fromRingrtc, SignalCalls, uuidBytes } from './signal-calls'

describe('signal calls', () => {
  it('reads a UUID as its sixteen bytes', () => {
    expect(Array.from(uuidBytes('00000000-0000-4000-8000-000000000001'))).toEqual([0, 0, 0, 0, 0, 0, 64, 0, 128, 0, 0, 0, 0, 0, 0, 1])
    expect(() => uuidBytes('nope')).toThrow()
  })

  it("writes RingRTC's message for the daemon with 64-bit ids as text", () => {
    const wire = fromRingrtc({
      offer: { callId: 18446744073709551000n, type: 1, opaque: new Uint8Array([1, 2]) },
      iceCandidates: [{ callId: 5n, opaque: new Uint8Array([3]) }],
      hangup: { callId: 5n, type: 2, deviceId: 3 },
      destinationDeviceId: 2
    } as never)
    expect(wire).toEqual({
      offer: { callId: '18446744073709551000', type: 1, opaque: 'AQI=' },
      iceCandidates: [{ callId: '5', opaque: 'Aw==' }],
      hangup: { callId: '5', type: 2, deviceId: 3 },
      destinationDeviceId: 2
    })
  })

  it('offers nothing when RingRTC cannot be loaded', () => {
    const calls = new SignalCalls({
      request: async () => null,
      emit: () => {},
      frame: () => {},
      load: () => {
        throw new Error('no native library')
      }
    })
    expect(calls.available()).toBe(false)
    expect(calls.current()).toBeNull()
  })
})
