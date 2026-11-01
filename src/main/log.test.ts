import { describe, expect, it } from 'vitest'
import { log } from './log'

describe('log', () => {
  it('survives the pipe under stdout closing after the write has returned', async () => {
    // What a closed terminal does to console.log: an 'error' event on the
    // stream, raised a tick later, with nothing listening unless log put it there.
    process.stdout.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
    expect(log.isBroken()).toBe(true)
    expect(() => log.info('after the pipe closed')).not.toThrow()
  })
})
