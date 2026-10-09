import { describe, expect, it, vi } from 'vitest'
import { bufferMenuEntries } from './buffermenu'

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
