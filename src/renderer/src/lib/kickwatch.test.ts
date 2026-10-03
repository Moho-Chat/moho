import { describe, expect, it } from 'vitest'
import { watchDelta, watchedKickBuffers } from './kickwatch'
import type { BufferEntry } from '../state/store'

const buffer = (id: string, kind = 'channel'): BufferEntry => ({ id, kind }) as BufferEntry

describe('which Kick channels count as watched', () => {
  const buffers = [buffer('kick:a|one'), buffer('kick:a|two'), buffer('irc|#x'), buffer('kick:a|dm', 'dm')]
  const serviceOf = (id: string): string => id.split(':')[0].split('|')[0]

  it('is the open channel and the stream on screen, Kick channels only, once each', () => {
    expect(watchedKickBuffers(buffers, 'kick:a|one', 'kick:a|two', serviceOf)).toEqual(['kick:a|one', 'kick:a|two'])
    expect(watchedKickBuffers(buffers, 'kick:a|one', 'kick:a|one', serviceOf)).toEqual(['kick:a|one'])
    expect(watchedKickBuffers(buffers, 'irc|#x', undefined, serviceOf)).toEqual([])
    expect(watchedKickBuffers(buffers, 'kick:a|dm', undefined, serviceOf)).toEqual([])
  })

  it('says what to start and stop as that changes', () => {
    expect(watchDelta(['a', 'b'], ['b', 'c'])).toEqual({ start: ['c'], stop: ['a'] })
    expect(watchDelta([], [])).toEqual({ start: [], stop: [] })
  })
})
