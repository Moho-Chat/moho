import { describe, expect, it, vi } from 'vitest'
import { ChatStore } from './store'

/** The store, with a conversation already in its list, and the daemon's update for it applied. */
function after(update: Record<string, unknown>, before: Record<string, unknown> = {}): Record<string, unknown> {
  const store = new ChatStore() as unknown as {
    state: { buffers: unknown[] }
    handleBufferListChange: (data: unknown) => void
  }
  const base = { id: 'm|!r', accountId: 'm', kind: 'channel', name: '!r', lastActivityTs: 0, unread: 0, highlight: false, mentions: 0 }
  store.state = { ...store.state, buffers: [{ ...base, ...before }] }
  // What the daemon sends carries no unread tally: that is this window's own.
  store.handleBufferListChange({ id: base.id, accountId: base.accountId, kind: base.kind, name: base.name, lastActivityTs: 0, ...update })
  return store.state.buffers[0] as Record<string, unknown>
}

describe('an update to a conversation the window already has', () => {
  it('takes a mute off when the daemon leaves it out', () => {
    // The daemon omits a flag that is off, so absent has to mean cleared: a
    // room unmuted on the account stayed drawn as muted, with an Unmute that
    // had nothing left to do.
    expect(after({}, { serverMuted: true }).serverMuted).toBe(false)
    expect(after({ serverMuted: true }, {}).serverMuted).toBe(true)
  })

  it('clears the other flags the same way, and keeps the unread count it holds', () => {
    const b = after({}, { favourite: true, lowPriority: true, readOnly: 'No permission', forum: true, unread: 4, mentions: 2, highlight: true })
    expect([b.favourite, b.lowPriority, b.readOnly, b.forum]).toEqual([false, false, undefined, false])
    expect([b.unread, b.mentions, b.highlight]).toEqual([4, 2, true])
  })
})

describe('scrolling to the top of a conversation', () => {
  function withHistory(rows: unknown[][]): { store: ChatStore; rpc: ReturnType<typeof vi.fn> } {
    const rpc = vi.fn()
    for (const answer of rows) rpc.mockResolvedValueOnce(answer)
    ;(globalThis as unknown as { window: unknown }).window = { moho: { rpc } }
    const store = new ChatStore() as unknown as { state: Record<string, unknown> }
    store.state = { ...store.state, messagesByBuffer: { b: [{ id: 'm1', ts: 100, bufferId: 'b', body: 'hello' }] }, loadingMore: {} }
    return { store: store as unknown as ChatStore, rpc }
  }

  it('asks for what is older once and, told there is none, does not ask again at the next scroll', async () => {
    const { store, rpc } = withHistory([[], []])
    await store.loadMoreHistory('b')
    await store.loadMoreHistory('b')
    await store.loadMoreHistory('b')
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('asks again once older messages have arrived, since what is oldest has changed', async () => {
    const { store, rpc } = withHistory([[{ id: 'm0', ts: 50, bufferId: 'b', body: 'before' }], []])
    await store.loadMoreHistory('b')
    await store.loadMoreHistory('b')
    await store.loadMoreHistory('b')
    expect(rpc).toHaveBeenCalledTimes(2)
  })
})
