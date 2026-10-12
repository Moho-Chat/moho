import { describe, expect, it } from 'vitest'
import type { Member } from '../../../shared/wire'
import type { BufferEntry } from '../state/store'
import { dmStatusText } from './presence'

const dm = { id: 'steam:me|Gabe', kind: 'dm', accountId: 'steam:me', name: 'Gabe' } as BufferEntry
const member = (extra: Partial<Member>): Member => ({ nick: 'Gabe', status: 'online', ...extra }) as Member

describe('what somebody is doing beside their dot', () => {
  it('is the game, or a state the colour shares, from the one-person list of a direct message', () => {
    expect(dmStatusText(dm, { [dm.id]: [member({ statusText: 'Playing Counter-Strike 2' })] })).toBe('Playing Counter-Strike 2')
    expect(dmStatusText(dm, { [dm.id]: [member({ statusText: 'Snoozing', status: 'idle' })] })).toBe('Snoozing')
  })

  it('is nothing when the dot says it all, or there is no word on them', () => {
    expect(dmStatusText(dm, { [dm.id]: [member({ statusText: null })] })).toBeUndefined()
    expect(dmStatusText(dm, { [dm.id]: [member({})] })).toBeUndefined()
    expect(dmStatusText(dm, {})).toBeUndefined()
  })

  it('is nothing for a room, however many members have a word', () => {
    const room = { ...dm, kind: 'channel' } as BufferEntry
    expect(dmStatusText(room, { [room.id]: [member({ statusText: 'Busy' })] })).toBeUndefined()
    // Nor for a list of several: it is only one person's when there is one.
    expect(dmStatusText(dm, { [dm.id]: [member({ statusText: 'Busy' }), member({ nick: 'x', statusText: 'Away' })] })).toBeUndefined()
  })
})
