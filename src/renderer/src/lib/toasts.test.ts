import { describe, expect, it } from 'vitest'
import { MAX_TOASTS, addToast, toastLifetime, type ToastItem } from './toasts'

const add = (list: ToastItem[], id: number, text: string, kind: ToastItem['kind'] = 'info', now = 1000): ToastItem[] =>
  addToast(list, { id, kind, text }, now)

describe('the toast stack', () => {
  it('folds the same words into one toast that says how many', () => {
    let list = add([], 1, 'Copied')
    list = add(list, 2, 'Copied', 'info', 2000)
    list = add(list, 3, 'Copied', 'info', 3000)
    expect(list).toHaveLength(1)
    expect(list[0].count).toBe(3)
    // Repeating it starts its time over.
    expect(list[0].stamp).toBe(3000)
  })

  it('keeps the same words of a different kind apart', () => {
    const list = add(add([], 1, 'Done'), 2, 'Done', 'error')
    expect(list).toHaveLength(2)
  })

  it('never holds more than a few, the oldest giving way', () => {
    let list: ToastItem[] = []
    for (let i = 1; i <= MAX_TOASTS + 2; i++) list = add(list, i, `message ${i}`)
    expect(list).toHaveLength(MAX_TOASTS)
    expect(list.map((t) => t.text)).toEqual(['message 3', 'message 4', 'message 5'])
  })

  it('gives errors and ones with something to press longer to be read', () => {
    const quiet = toastLifetime({ kind: 'info', text: 'Copied', action: undefined })
    const error = toastLifetime({ kind: 'error', text: 'Copied', action: undefined })
    const actionable = toastLifetime({ kind: 'info', text: 'Copied', action: { label: 'Undo', onClick: () => {} } })
    expect(error).toBeGreaterThan(quiet)
    expect(actionable).toBeGreaterThan(quiet)
  })
})
