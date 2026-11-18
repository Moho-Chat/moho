import { describe, expect, it } from 'vitest'
import { callLinkKey, fromRingrtc, SignalCalls, uuidBytes } from './signal-calls'

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

  it('takes the key out of a call link address', () => {
    expect(callLinkKey('https://signal.link/call/#key=BCDF-ghkm-npqr')).toBe('bcdf-ghkm-npqr')
    expect(callLinkKey('signal.link/call#key=bcdf-ghkm')).toBe('bcdf-ghkm')
    expect(callLinkKey('https://signal.group/#abc')).toBeUndefined()
  })

  it('makes a call link, keeping it in the shared records before naming it', async () => {
    const asked: [string, Record<string, unknown>][] = []
    const order: string[] = []
    class Key {
      constructor(readonly bytes: Uint8Array) {}
      static generate(): Key {
        return new Key(new Uint8Array(16).fill(7))
      }
      static generateAdminPassKey(): Uint8Array {
        return new Uint8Array([9, 9])
      }
      deriveRoomId(): Uint8Array {
        return new Uint8Array([1])
      }
      toString(): string {
        return 'bcdf-ghkm'
      }
    }
    const state = (name: string) => ({ name, restrictions: 1, revoked: false, expiration: new Date(5000), rootKey: new Key(new Uint8Array(16).fill(7)) })
    const rtc = {
      CallLinkRootKey: Key,
      CallLinkRestrictions: { None: 0, AdminApproval: 1 },
      RingRTC: {
        createCallLink: async (_url: string, _p: Uint8Array, _k: Key, _a: Uint8Array, _pp: Uint8Array, restrictions: number) => {
          order.push(`create ${restrictions}`)
          return { success: true, value: state('') }
        },
        updateCallLinkName: async (_url: string, _p: Uint8Array, _k: Key, _a: Uint8Array, name: string) => {
          order.push(`name ${name}`)
          return { success: true, value: state(name) }
        }
      }
    }
    const calls = new SignalCalls({
      request: async (method, params) => {
        asked.push([method, params])
        if (method === 'signalCallLinkSave') order.push('save')
        if (method === 'signalCallLinkJoinInfo') return { accountId: 'a', presentation: 'AQ==', endorsementPublicKey: 'AQ==', sfuUrl: 'https://sfu', ownAci: 'x' }
        if (method === 'signalCallLinkCreateInfo') return { presentation: 'Ag==', publicParams: 'Aw==' }
        return true
      },
      emit: () => {},
      frame: () => {},
      load: () => rtc as never
    })
    ;(calls as unknown as { wire: () => void }).wire = () => {}
    const made = await calls.createCallLink('a', ' Book club ', true)
    expect(order).toEqual(['create 1', 'save', 'name Book club'])
    expect(made).toEqual({ link: 'https://signal.link/call/#key=bcdf-ghkm', rootKey: 'BwcHBwcHBwcHBwcHBwcHBw==', name: 'Book club', approval: true, revoked: false, expires: 5000, admin: true })
    expect(asked.find(([m]) => m === 'signalCallLinkSave')?.[1]).toEqual({ accountId: 'a', rootKey: 'BwcHBwcHBwcHBwcHBwcHBw==', adminPasskey: 'CQk=' })
    expect(asked.find(([m]) => m === 'signalCallLinkCreateInfo')?.[1]).toEqual({ accountId: 'a', rootKey: 'BwcHBwcHBwcHBwcHBwcHBw==', roomId: 'AQ==' })
  })
})
