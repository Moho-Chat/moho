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

// Offline: the bubble hollow and struck through. Nothing will arrive, which a
// quiet tray otherwise cannot tell apart from nothing having arrived.
function offline(ink) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 64 64">
    <mask id="m"><rect width="64" height="64" fill="#fff"/><path d="M6 6 58 58" stroke="#000" stroke-width="13" stroke-linecap="round"/></mask>
    <path d="${BUBBLE}" fill="none" stroke="${ink}" stroke-width="5" stroke-linejoin="round" opacity="0.75" mask="url(#m)" transform="translate(3.2 3.2) scale(0.9)"/>
    <path d="M9 9 55 55" stroke="${ink}" stroke-width="5.5" stroke-linecap="round"/></svg>`
}

// Quiet: Do not disturb, or notifications paused. A moon where the count
// would be, and no count: it was asked not to wave one about.
function quiet(ink) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 64 64">
    <mask id="m"><rect width="64" height="64" fill="#fff"/><circle cx="45" cy="19" r="19" fill="#000"/></mask>
    <path d="${BUBBLE}" fill="${ink}" opacity="0.8" mask="url(#m)"/>
    <mask id="moon"><rect width="64" height="64" fill="#000"/><circle cx="45" cy="19" r="15" fill="#fff"/><circle cx="52" cy="13" r="12" fill="#000"/></mask>
    <rect width="64" height="64" fill="#f5b83d" mask="url(#moon)"/></svg>`
}

function svg(ink, label) {
  const badge = label !== null
  // The badge sits in a gap cut from the bubble, so it reads against any panel
  // without a ring of a colour that panel may not be.
  // Without one, three dots are cut from it, which is what makes the shape a
  // conversation and not a label.
  const mask = badge
    ? `<mask id="m"><rect width="64" height="64" fill="#fff"/><circle cx="45" cy="19" r="19" fill="#000"/></mask>`
    : `<mask id="m"><rect width="64" height="64" fill="#fff"/><circle cx="21" cy="27" r="4" fill="#000"/><circle cx="32" cy="27" r="4" fill="#000"/><circle cx="43" cy="27" r="4" fill="#000"/></mask>`
  // Two characters are set smaller and tighter, so the plus stays inside the badge it is on.
  const wide = label && label.length > 1
  const size = wide ? 20 : 30
  const text = badge
    ? `<circle cx="45" cy="19" r="16.5" fill="${BADGE}"/><text x="45" y="${19 + size * 0.36}" font-family="DejaVu Sans" font-weight="bold" font-size="${size}" text-anchor="middle" fill="#fff"${wide ? ' letter-spacing="-1.5"' : ''}>${label}</text>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 64 64">${mask}<path d="${BUBBLE}" fill="${ink}" mask="url(#m)"/>${text}</svg>`
}

mkdirSync(out, { recursive: true })
const labels = [null, '1', '2', '3', '4', '5', '6', '7', '8', '9', '9+']
for (const [name, ink] of [['light', '#f1f3f5'], ['dark', '#25282e']]) {
  for (const [state, draw] of [['offline', offline], ['quiet', quiet]]) {
    const file = join(out, `tray-${name}-${state}.png`)
    const tmp = `${file}.svg`
    writeFileSync(tmp, draw(ink))
    execFileSync('rsvg-convert', ['-w', String(SIZE), '-h', String(SIZE), '-o', file, tmp])
    rmSync(tmp)
  }
  for (const label of labels) {
    const file = join(out, `tray-${name}${label === null ? '' : `-${label === '9+' ? 'more' : label}`}.png`)
    const tmp = `${file}.svg`
    writeFileSync(tmp, svg(ink, label))
    execFileSync('rsvg-convert', ['-w', String(SIZE), '-h', String(SIZE), '-o', file, tmp])
    rmSync(tmp)
  }
}
console.log('tray icons written to', out)
