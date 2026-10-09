import { describe, expect, it } from 'vitest'
import { IdleWatcher } from './idle'

const MIN = 60_000

/** A watcher on a clock the test holds, with the system's idle time a figure it sets. */
function watcher(over: { enabled?: boolean; minutes?: number } = {}): {
  w: IdleWatcher
  clock: { now: number; system: number; enabled: boolean }
  said: boolean[]
} {
  const clock = { now: 1_000_000, system: 0, enabled: over.enabled ?? true }
  const said: boolean[] = []
  const w = new IdleWatcher({
    now: () => clock.now,
    systemIdleSeconds: () => clock.system,
    enabled: () => clock.enabled,
    thresholdMs: () => (over.minutes ?? 10) * MIN,
    onChange: (idle) => said.push(idle)
  })
  return { w, clock, said }
}

describe('being away, by moho\'s own windows', () => {
  it('is away after the threshold with nothing touched, and says so once', () => {
    const { w, clock, said } = watcher()
    clock.now += 9 * MIN
    w.evaluate()
    expect(w.isIdle()).toBe(false)
    clock.now += 2 * MIN
    w.evaluate()
    w.evaluate()
    expect(w.isIdle()).toBe(true)
    expect(said).toEqual([true])
  })

  it('is back the moment anything is used', () => {
    const { w, clock, said } = watcher()
    clock.now += 11 * MIN
    w.evaluate()
    w.activity()
    expect(w.isIdle()).toBe(false)
    expect(said).toEqual([true, false])
  })

  it('counts use as starting the clock again', () => {
    const { w, clock } = watcher()
    clock.now += 9 * MIN
    w.activity()
    clock.now += 9 * MIN
    w.evaluate()
    expect(w.isIdle()).toBe(false)
  })

  it('does nothing at all when it is switched off', () => {
    const { w, clock, said } = watcher({ enabled: false })
    clock.now += 60 * MIN
    w.evaluate()
    expect(said).toEqual([])
  })

  it('comes back when it is switched off while away', () => {
    const { w, clock, said } = watcher()
    clock.now += 11 * MIN
    w.evaluate()
    clock.enabled = false
    w.evaluate()
    expect(said).toEqual([true, false])
  })
})

describe('being away, by the system\'s idle time', () => {
  it('does not take a zero that never changes for somebody who never stops', () => {
    // A platform that cannot say reports zero for ever; moho's own windows decide.
    const { w, clock } = watcher()
    clock.system = 0
    clock.now += 11 * MIN
    w.evaluate()
    expect(w.isIdle()).toBe(true)
  })

  it('believes the system once it has been seen to be anything but zero, and counts use elsewhere as being here', () => {
    const { w, clock } = watcher()
    clock.system = 3
    w.evaluate()
    // Eleven minutes of not touching moho, but the keyboard was used a minute ago.
    clock.now += 11 * MIN
    clock.system = 60
    w.evaluate()
    expect(w.isIdle()).toBe(false)
    // And then it really is eleven minutes everywhere.
    clock.system = 11 * 60
    w.evaluate()
    expect(w.isIdle()).toBe(true)
  })
})

describe('locking', () => {
  it('is away at once when the screen locks and back when it unlocks', () => {
    const { w, said } = watcher()
    w.lock()
    expect(w.isIdle()).toBe(true)
    w.unlock()
    expect(w.isIdle()).toBe(false)
    expect(said).toEqual([true, false])
  })
})
