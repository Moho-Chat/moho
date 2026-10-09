#!/usr/bin/env node
// Draws the tray icons into resources/icons/tray-*.png.
//
// A tray cannot be recoloured by the desktop the way a themed icon can, so
// there is one set for a dark panel (a light bubble) and one for a light panel
// (a dark bubble), and main picks by the system's colour scheme. Each set is
// the bubble alone, and the bubble with a red badge carrying the number of
// conversations waiting - 1 to 9, then 9+ - because a tray is the one place
// still in view when a notification has faded, and "something" is a poorer
// answer than "three things".
//
// Run when the artwork changes; the PNGs are committed. Needs rsvg-convert.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'icons')
const SIZE = 64
// The app's mention red, so the badge is the same colour as the one in the window.
const BADGE = '#e5484d'

const BUBBLE = 'M14 8h36a8 8 0 0 1 8 8v22a8 8 0 0 1-8 8H34L22 58V46h-8a8 8 0 0 1-8-8V16a8 8 0 0 1 8-8z'

function svg(ink, label) {
  const badge = label !== null
  // The badge sits in a gap cut from the bubble, so it reads against any panel
  // without a ring of a colour that panel may not be.
  // Without one, three dots are cut from it, which is what makes the shape a
  // conversation and not a label.
  const mask = badge
    ? `<mask id="m"><rect width="64" height="64" fill="#fff"/><circle cx="46" cy="18" r="19" fill="#000"/></mask>`
    : `<mask id="m"><rect width="64" height="64" fill="#fff"/><circle cx="21" cy="27" r="4" fill="#000"/><circle cx="32" cy="27" r="4" fill="#000"/><circle cx="43" cy="27" r="4" fill="#000"/></mask>`
  const size = label && label.length > 1 ? 24 : 30
  const text = badge
    ? `<circle cx="46" cy="18" r="16" fill="${BADGE}"/><text x="46" y="${18 + size * 0.36}" font-family="DejaVu Sans" font-weight="bold" font-size="${size}" text-anchor="middle" fill="#fff">${label}</text>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 64 64">${mask}<path d="${BUBBLE}" fill="${ink}" mask="url(#m)"/>${text}</svg>`
}

mkdirSync(out, { recursive: true })
const labels = [null, '1', '2', '3', '4', '5', '6', '7', '8', '9', '9+']
for (const [name, ink] of [['light', '#f1f3f5'], ['dark', '#25282e']]) {
  for (const label of labels) {
    const file = join(out, `tray-${name}${label === null ? '' : `-${label === '9+' ? 'more' : label}`}.png`)
    const tmp = `${file}.svg`
    writeFileSync(tmp, svg(ink, label))
    execFileSync('rsvg-convert', ['-w', String(SIZE), '-h', String(SIZE), '-o', file, tmp])
    rmSync(tmp)
  }
}
console.log('tray icons written to', out)
