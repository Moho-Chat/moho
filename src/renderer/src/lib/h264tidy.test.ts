import { describe, expect, it } from 'vitest'
import { newTidyState, tidyH264, units } from './h264tidy'

const SC = [0, 0, 0, 1]
/** One NAL unit with a four-byte start code: header byte, then a body. */
const nal = (type: number, body: number[] = [0xaa, 0xbb]): number[] => [...SC, (3 << 5) | type, ...body]
const frame = (...parts: number[][]): Uint8Array => new Uint8Array(parts.flat())
const types = (b: Uint8Array): number[] => units(b).map((u) => u.type)

describe('units', () => {
  it('splits on three- and four-byte start codes', () => {
    const b = new Uint8Array([0, 0, 0, 1, 0x67, 1, 2, 0, 0, 1, 0x68, 3, 0, 0, 0, 1, 0x65, 4])
    expect(types(b)).toEqual([7, 8, 5])
  })

  it('finds nothing in bytes with no start code', () => {
    expect(units(new Uint8Array([1, 2, 3]))).toEqual([])
  })
})

describe('tidyH264', () => {
  it('moves parameter sets that trail the IDR slice in front of it', () => {
    // The layout a Fluxer screen share sent: 5, 7, 8 in one keyframe.
    const out = tidyH264(frame(nal(5), nal(7), nal(8)), newTidyState())!
    expect(types(out)).toEqual([7, 8, 5])
    expect(out.length).toBe(frame(nal(5), nal(7), nal(8)).length)
  })

  it('drops filler data', () => {
    const filler = nal(12, new Array(500).fill(0xff))
    const out = tidyH264(frame(nal(1), filler), newTidyState())!
    expect(types(out)).toEqual([1])
    expect(out.length).toBe(nal(1).length)
  })

  it('holds back a frame of parameter sets alone, and lends them to a bare IDR', () => {
    const state = newTidyState()
    expect(tidyH264(frame(nal(7, [1]), nal(8, [2])), state)).toBeNull()
    const out = tidyH264(frame(nal(5, [9])), state)!
    expect(types(out)).toEqual([7, 8, 5])
    expect(Array.from(out)).toEqual([...nal(7, [1]), ...nal(8, [2]), ...nal(5, [9])])
  })

  it('leaves a bare IDR alone when no parameter sets have been seen', () => {
    const b = frame(nal(5))
    expect(tidyH264(b, newTidyState())).toBe(b)
  })

  it('returns a frame that already reads well untouched', () => {
    const state = newTidyState()
    const key = frame(nal(7), nal(8), nal(5))
    expect(tidyH264(key, state)).toBe(key)
    const delta = frame(nal(1))
    expect(tidyH264(delta, state)).toBe(delta)
  })

  it('does not lend parameter sets to a delta frame', () => {
    const state = newTidyState()
    tidyH264(frame(nal(7), nal(8)), state)
    const delta = frame(nal(1))
    expect(tidyH264(delta, state)).toBe(delta)
  })

  it('passes a slice-less frame that is not parameter sets', () => {
    const sei = frame(nal(6))
    expect(tidyH264(sei, newTidyState())).toBe(sei)
  })
})
