/**
 * The rail's name flyout, instead of the browser's own tooltip.
 *
 * A native `title` waits most of a second before it appears and cannot be
 * styled; the rail is where somebody moves the pointer down a column of
 * unlabelled squares asking which is which, so the answer has to be there as
 * the pointer arrives. Tiles say what to show; one flyout draws it.
 */
export const RAIL_TIP = 'moho:rail-tip'

export interface RailTipDetail {
  text: string
  /** Where the tile is, in window coordinates, or null to hide the flyout. */
  rect: { top: number; right: number; height: number } | null
}

export function showRailTip(el: HTMLElement, text: string): void {
  const r = el.getBoundingClientRect()
  window.dispatchEvent(new CustomEvent<RailTipDetail>(RAIL_TIP, { detail: { text, rect: { top: r.top, right: r.right, height: r.height } } }))
}

export function hideRailTip(): void {
  window.dispatchEvent(new CustomEvent<RailTipDetail>(RAIL_TIP, { detail: { text: '', rect: null } }))
}
