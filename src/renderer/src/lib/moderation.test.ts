import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../state/store'
import { applyRemoved, removedReason, REMOVED_NOTICE } from './moderation'

const said = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, bufferId: 'b', from: 'x', body: `text ${id}`, ts: 1, isAction: false, isHighlight: false, kind: 'chat', ...extra }) as ChatMessage

const log = [said('a'), said('b', { moderated: { ai: true, rules: ['hate'] }, html: '<b>x</b>', embeds: [{ kind: 'gif' } as never] }), said('c')]

describe('removed messages', () => {
  it('are left out when that is chosen', () => {
    expect(applyRemoved(log, 'remove').map((m) => m.id)).toEqual(['a', 'c'])
  })
  it('keep their words when struck through is chosen, and the list is the same one', () => {
    expect(applyRemoved(log, 'strike')).toBe(log)
  })
  it('have a notice put where their words were when that is chosen', () => {
    const [, removed] = applyRemoved(log, 'replace')
    expect(removed.body).toBe(REMOVED_NOTICE)
    expect(removed.html).toBeUndefined()
    expect(removed.embeds).toEqual([])
    expect(removed.moderated).toEqual({ ai: true, rules: ['hate'], replaced: true })
    // And only that one.
    expect(applyRemoved(log, 'replace')[0].body).toBe('text a')
  })
  it('change nothing in a log where nothing was removed', () => {
    const clean = [said('a')]
    expect(applyRemoved(clean, 'remove')).toBe(clean)
    expect(applyRemoved(clean, 'replace')).toBe(clean)
  })
  it('say why they were removed when they know', () => {
    expect(removedReason(log[1])).toBe("Removed by Kick's automatic moderation: hate")
    expect(removedReason(said('d', { moderated: {} }))).toBe('Removed')
  })
})
