import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = ['theme.css', 'app.css'].map((f) => readFileSync(join(__dirname, f), 'utf8')).join('\n')

describe('the stylesheets', () => {
  it('only use custom properties that something defines, or that carry a fallback', () => {
    const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]))
    // `var(--x)` with no comma is a use with no fallback.
    const used = [...css.matchAll(/var\((--[a-z0-9-]+)\s*\)/gi)].map((m) => m[1])
    const missing = [...new Set(used.filter((name) => !defined.has(name)))]
    // An undefined property draws a border in the text colour and text in
    // whatever it inherited - which is how seven of them went unnoticed (#268).
    expect(missing).toEqual([])
  })
})
