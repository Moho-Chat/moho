import { describe, expect, it } from 'vitest'
import type { Member } from '../../../shared/wire'
import type { BufferEntry } from '../state/store'
import { activityIcon, activityLabel, dmActivity } from './activity'

const dm = { id: 'steam:me|Gabe', kind: 'dm', accountId: 'steam:me', name: 'Gabe' } as BufferEntry
const member = (extra: Partial<Member>): Member => ({ nick: 'Gabe', status: 'online', ...extra }) as Member

describe('what somebody is doing, under their name', () => {
  it('has a gamepad for a game, a note for a track, and nothing for words they wrote', () => {
    expect(activityIcon({ kind: 'game', text: 'Resident Evil 4' })).toBe('sports_esports')
    expect(activityIcon({ kind: 'music', text: 'Ramones' })).toBe('music_note')
    expect(activityIcon({ kind: 'custom', text: 'ask questions' })).toBeUndefined()
  })

  it('reads as a sentence where there is no room for a picture', () => {
    expect(activityLabel({ kind: 'game', text: 'Dota 2' })).toBe('Playing Dota 2')
    expect(activityLabel({ kind: 'music', text: 'Ramones' })).toBe('Listening to Ramones')
    expect(activityLabel({ kind: 'custom', text: 'ask questions' })).toBe('ask questions')
  })

  it('is the one person of a direct message, and nobody else', () => {
    const playing = { kind: 'game', text: 'Dota 2' } as const
    expect(dmActivity(dm, { [dm.id]: [member({ activity: playing })] })).toEqual(playing)
    expect(dmActivity(dm, { [dm.id]: [member({ activity: null })] })).toBeUndefined()
    expect(dmActivity(dm, { [dm.id]: [member({})] })).toBeUndefined()
    expect(dmActivity(dm, {})).toBeUndefined()
    const room = { ...dm, kind: 'channel' } as BufferEntry
    expect(dmActivity(room, { [room.id]: [member({ activity: playing })] })).toBeUndefined()
    expect(dmActivity(dm, { [dm.id]: [member({ activity: playing }), member({ nick: 'x', activity: playing })] })).toBeUndefined()
  })
})
