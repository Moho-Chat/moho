import { describe, expect, it } from 'vitest'
import { bufferLink } from './bufferlink'
import type { Account, Buffer } from '../../../shared/wire'

const account = (state: string): Account => ({ id: 'a', displayName: 'Ancient Pioneer', state }) as Account
const buffer = (link?: Buffer['link']): Buffer => ({ id: 'a|#general', accountId: 'a', link }) as Buffer

describe('whether a conversation is receiving', () => {
  it('is, when the account is connected and the buffer has no link of its own', () => {
    expect(bufferLink(buffer(), account('connected'))).toBeNull()
  })

  it('follows the account while the account is down, with its progress', () => {
    expect(bufferLink(buffer(), account('connecting'), 'logging in...')).toEqual({ retrying: true, detail: 'logging in...' })
    expect(bufferLink(buffer(), account('auth_failed'))?.retrying).toBe(false)
    expect(bufferLink(buffer(), account('disconnected'))?.detail).toMatch(/disconnected/)
  })

  it("takes the buffer's own link when the account is fine", () => {
    expect(bufferLink(buffer({ state: 'connecting' }), account('connected'))?.retrying).toBe(true)
    const chat = bufferLink(buffer({ state: 'down', cause: 'chat', detail: 'The chat is down' }), account('connected'))
    expect(chat).toEqual({ retrying: true, detail: 'The chat is down', cause: 'chat' })
    // A refused join is not retried by anything.
    expect(bufferLink(buffer({ state: 'down', cause: 'refused', detail: 'banned' }), account('connected'))?.retrying).toBe(false)
  })
})
