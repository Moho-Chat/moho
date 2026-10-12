import { describe, expect, it } from 'vitest'
import type { Account } from '../../../shared/wire'
import type { BufferEntry } from '../state/store'
import { bufferMenuEntries, type BufferMenuInput } from './buffermenu'

const buffer = { id: 'steam:me|Gabe', accountId: 'steam:me', kind: 'dm', name: 'Gabe', remoteId: '76561197960265829' } as BufferEntry
const account = { id: 'steam:me', service: 'steam' } as Account
const noop = (): void => {}

function menu(extra: Partial<BufferMenuInput> = {}): string[] {
  const entries = bufferMenuEntries({
    buffer, account, muted: false, pinned: false, filed: false, inCall: false, poppedOut: false, canCall: false,
    live: false, watched: false, onTogglePin: noop, onToggleMute: noop, onHide: noop, onClose: noop, onCall: noop,
    onHangUp: noop, onFile: noop, onPopOut: noop, onDock: noop, ...extra
  })
  return entries.flatMap((e) => ('label' in e && e.label ? [e.label] : []))
}

describe('the menu of a conversation with a Steam friend', () => {
  it('offers what to call them, ending the friendship and blocking them, when it is told they are one', () => {
    const asked: string[] = []
    const labels = menu({ onSteamFriend: (what) => asked.push(what) })
    expect(labels).toEqual(expect.arrayContaining(['Set nickname…', 'Remove friend', 'Block']))
    const entries = bufferMenuEntries({
      buffer, account, muted: false, pinned: false, filed: false, inCall: false, poppedOut: false, canCall: false,
      live: false, watched: false, onTogglePin: noop, onToggleMute: noop, onHide: noop, onClose: noop, onCall: noop,
      onHangUp: noop, onFile: noop, onPopOut: noop, onDock: noop, onSteamFriend: (what) => asked.push(what)
    })
    for (const label of ['Set nickname…', 'Remove friend', 'Block']) {
      const entry = entries.find((e) => 'label' in e && e.label === label)
      if (entry && 'onClick' in entry) entry.onClick?.()
    }
    expect(asked).toEqual(['nickname', 'remove', 'block'])
  })

  it('does not, anywhere else', () => {
    const labels = menu()
    expect(labels).not.toContain('Remove friend')
    expect(labels).not.toContain('Block')
    expect(labels).not.toContain('Set nickname…')
  })
})
