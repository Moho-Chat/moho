import { describe, expect, it, vi } from 'vitest'
import { bufferMenuEntries, leaveLabel } from './buffermenu'

const noop = (): void => {}

function entries(over: Record<string, unknown>) {
  return bufferMenuEntries({
    buffer: { id: 'b', accountId: 'matrix:@me:x', name: '!r:x', kind: 'channel', serverMuted: true },
    account: { id: 'matrix:@me:x', service: 'matrix' },
    muted: false,
    pinned: false,
    filed: false,
    inCall: false,
    poppedOut: false,
    canCall: false,
    live: false,
    watched: false,
    onTogglePin: noop,
    onToggleMute: noop,
    onHide: noop,
    onClose: noop,
    onCall: noop,
    onHangUp: noop,
    onFile: noop,
    onPopOut: noop,
    onDock: noop,
    ...over
  } as never) as { label?: string; disabled?: boolean; onClick?: () => void }[]
}

describe('a mute held on the account', () => {
  it('can be taken off where the service lets it be, and that is what the entry does', () => {
    const unmute = vi.fn()
    const toggle = vi.fn()
    const entry = entries({ onUnmuteAccount: unmute, onToggleMute: toggle }).find((e) => e.label === 'Unmute')
    expect(entry).toBeDefined()
    expect(entry?.disabled).toBeFalsy()
    entry?.onClick?.()
    expect(unmute).toHaveBeenCalled()
    // Not the window's own mute, which would only have added a second one.
    expect(toggle).not.toHaveBeenCalled()
  })

  it('says where it is where it cannot be taken off from here', () => {
    const entry = entries({}).find((e) => (e.label ?? '').startsWith('Muted on'))
    expect(entry?.label).toBe('Muted on Matrix')
    expect(entry?.disabled).toBe(true)
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
