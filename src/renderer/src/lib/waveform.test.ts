import { describe, expect, it } from 'vitest'
import { reduceLevels } from './waveform'

describe('a waveform worked out from the sound', () => {
  it('is averaged down to the bars drawn, and a silence is still a bar', () => {
    expect(reduceLevels([1, 1, 0, 0], 2)).toEqual([1, 0.08])
    expect(reduceLevels([0.5], 3)).toEqual([0.5, 0.5, 0.5])
    expect(reduceLevels([], 4)).toEqual([0.25, 0.25, 0.25, 0.25])
  })
})
