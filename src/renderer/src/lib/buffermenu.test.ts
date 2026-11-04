import { describe, expect, it, vi } from 'vitest'
import { bufferMenuEntries, leaveLabel } from './buffermenu'

const noop = (): void => {}

function entries(over: Record<string, unknown>, buffer: Record<string, unknown> = {}) {
  return bufferMenuEntries({
    buffer: { id: 'b', accountId: 'matrix:@me:x', name: '!r:x', kind: 'channel', ...buffer },
    account: { id: 'matrix:@me:x', service: 'matrix' },
    pinned: false,
    filed: false,
    inCall: false,
    poppedOut: false,
    canCall: false,
    live: false,
    watched: false,
    onTogglePin: noop,
    notifyLevels: ['default', 'all', 'mentions', 'mute'],
    onSetNotify: noop,
    onHide: noop,
    onClose: noop,
    onCall: noop,
    onHangUp: noop,
    onFile: noop,
    onPopOut: noop,
    onDock: noop,
    ...over
  } as never) as { label?: string; heading?: string; checked?: boolean; disabled?: boolean; onClick?: () => void }[]
}

describe('how much a conversation may interrupt', () => {
  it('is a group of choices in Element\'s own words for a Matrix room', () => {
    const labels = entries({}).map((e) => e.label ?? e.heading)
    expect(labels).toEqual(expect.arrayContaining(['Notifications', 'Match default settings', 'All messages', 'Mentions and keywords', 'Mute room']))
  })

  it('says the same thing in plainer words elsewhere, for a conversation as well as a channel', () => {
    const discord = { id: 'discord:1', service: 'discord' }
    const channel = entries({ account: discord }, { accountId: 'discord:1' }).map((e) => e.label)
    expect(channel).toEqual(expect.arrayContaining(['Default', 'All messages', 'Mentions only', 'Mute channel']))
    const dm = entries({ account: discord }, { accountId: 'discord:1', kind: 'dm' }).map((e) => e.label)
    expect(dm).toContain('Mute conversation')
  })

  it('ticks what was set, and the default when nothing was', () => {
    const ticked = (buffer: Record<string, unknown>) => entries({}, buffer).filter((e) => e.checked).map((e) => e.label)
    expect(ticked({})).toEqual(['Match default settings'])
    expect(ticked({ notify: 'mentions' })).toEqual(['Mentions and keywords'])
    expect(ticked({ notify: 'mute' })).toEqual(['Mute room'])
    expect(ticked({ notify: 'all' })).toEqual(['All messages'])
  })

  it('sets the level that was chosen, and nothing else', () => {
    const set = vi.fn()
    const toggle = entries({ onSetNotify: set }).find((e) => e.label === 'Mentions and keywords')
    toggle?.onClick?.()
    expect(set).toHaveBeenCalledWith('mentions')
    expect(set).toHaveBeenCalledTimes(1)
  })

  it('offers only what the service can keep', () => {
    const labels = entries({ notifyLevels: ['default', 'mute'] }).map((e) => e.label)
    expect(labels).toContain('Mute room')
    expect(labels).not.toContain('All messages')
    expect(labels).not.toContain('Mentions and keywords')
  })

  it('says why a channel ticked as default is silent anyway, rather than leaving the menu to claim otherwise', () => {
    const entry = entries({ account: { id: 'discord:1', service: 'discord' } }, { accountId: 'discord:1', notifyApplied: 'mute' }).find((e) =>
      (e.label ?? '').startsWith('Silenced by')
    )
    expect(entry?.label).toBe('Silenced by its Discord server')
    expect(entry?.disabled).toBe(true)
  })

  it('does not say it where the conversation is muted itself', () => {
    const labels = entries({}, { notify: 'mute', notifyApplied: 'mute' }).map((e) => e.label ?? '')
    expect(labels.some((l) => l.startsWith('Silenced by'))).toBe(false)
  })
})

describe('what leaving is called', () => {
  const room = { id: 'b', accountId: 'steam:me', name: 'Raiders/#General', kind: 'channel' } as never
  const friend = { id: 'b', accountId: 'steam:me', name: 'Gabe', kind: 'dm' } as never

  it('is leaving the group for a room of a Steam group, which cannot be left on its own', () => {
    expect(leaveLabel(room, 'steam')).toBe('Leave group…')
  })

  it('is leaving the conversation for a friend, and the same words as before elsewhere', () => {
    expect(leaveLabel(friend, 'steam')).toBe('Leave conversation')
    expect(leaveLabel(room, 'matrix')).toBe('Leave room')
    expect(leaveLabel(room, 'irc')).toBe('Leave channel')
    expect(leaveLabel(room, 'discord')).toBe('Remove from list')
  })
})
