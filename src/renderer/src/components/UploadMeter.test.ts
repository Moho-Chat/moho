import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { UploadMeter } from './UploadMeter'

const draw = (props: Partial<Parameters<typeof UploadMeter>[0]>): string =>
  renderToStaticMarkup(
    createElement(UploadMeter, { phase: 'sending', bytes: 0, host: 'Discord', since: Date.now(), ...props })
  )

describe('the upload meter', () => {
  it('fills as bytes are counted, and says how far', () => {
    const html = draw({ sent: 2_097_152, total: 8_388_608 })
    expect(html).toContain('counted')
    expect(html).toContain('25%')
    expect(html).toContain('2.0 MB of 8.0 MB')
    // A quarter of the circumference of r=6, then the rest.
    const [arc, gap] = /stroke-dasharray:([\d.]+) ([\d.]+)/.exec(html)!.slice(1).map(Number)
    expect(arc / gap).toBeCloseTo(0.25, 2)
  })

  it('says how many files, when it is several', () => {
    expect(draw({ sent: 1, total: 4, files: 3 })).toContain('3 files')
    expect(draw({ phase: 'preparing', bytes: 0, files: 3 })).toContain('Preparing the 3 files')
  })

  it('keeps turning where nothing is counted', () => {
    const html = draw({ bytes: 3000, host: 'catbox.moe' })
    expect(html).not.toContain('counted')
    expect(html).not.toContain('dasharray')
    expect(html).toContain('Uploading 3 KB to catbox.moe')
  })

  it('waits for the host without emptying the ring', () => {
    const html = draw({ phase: 'waiting', sent: 4, total: 4 })
    expect(html).toContain('Waiting for Discord')
    expect(html).not.toContain('counted')
  })
})
