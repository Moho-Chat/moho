// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { galleryAround, registerMedia, stepIndex } from './gallery'

describe('gallery', () => {
  it('lists what is registered in page order, whatever order it registered in', () => {
    const list = document.createElement('div')
    list.className = 'message-list'
    const [a, b, c] = ['a', 'b', 'c'].map(() => list.appendChild(document.createElement('span')))
    document.body.appendChild(list)
    const offs = [registerMedia(c, () => 'c'), registerMedia(a, () => 'a'), registerMedia(b, () => 'b')]
    const g = galleryAround<string>(b)
    expect(g?.items.map((f) => f())).toEqual(['a', 'b', 'c'])
    expect(g?.index).toBe(1)
    offs.forEach((off) => off())
    expect(galleryAround(b)).toBeNull()
    list.remove()
  })

  it('keeps another conversation out of it', () => {
    const one = document.createElement('div')
    one.className = 'message-list'
    const two = document.createElement('div')
    two.className = 'thread-panel'
    const x = one.appendChild(document.createElement('span'))
    const y = two.appendChild(document.createElement('span'))
    document.body.append(one, two)
    registerMedia(x, () => 'x')
    registerMedia(y, () => 'y')
    expect(galleryAround<string>(x)?.items.length).toBe(1)
  })

  it('steps and stops at the ends', () => {
    expect(stepIndex(0, 3, 1)).toBe(1)
    expect(stepIndex(0, 3, -1)).toBeNull()
    expect(stepIndex(2, 3, 1)).toBeNull()
  })
})
