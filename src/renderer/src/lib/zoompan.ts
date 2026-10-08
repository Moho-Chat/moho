/**
 * Zooming a picture in a window and moving it about, as the viewer does.
 *
 * The picture is drawn centred and scaled about its own middle, so a view is
 * how far it is magnified and how far that middle has been moved from the
 * window's. Pure, so it can be tested without a window to measure.
 */

export interface View {
  /** 1 is the picture fitted to the window; more is closer in. */
  scale: number
  x: number
  y: number
}

export interface Size {
  w: number
  h: number
}

export const FIT: View = { scale: 1, x: 0, y: 0 }
export const MAX_SCALE = 8

/**
 * Keeps the picture from being carried out of reach: its edges can be brought
 * to the window's but not past them, and a picture still smaller than the
 * window stays where it is.
 */
export function clampView(v: View, fitted: Size, stage: Size): View {
  const slackX = Math.max(0, (fitted.w * v.scale - stage.w) / 2)
  const slackY = Math.max(0, (fitted.h * v.scale - stage.h) / 2)
  return {
    scale: v.scale,
    x: Math.max(-slackX, Math.min(slackX, v.x)),
    y: Math.max(-slackY, Math.min(slackY, v.y))
  }
}

/**
 * Magnifies by `factor` about a point - given from the window's centre - so
 * the part of the picture under that point stays under it, which is what
 * makes a wheel turn feel like moving in on something rather than at it.
 */
export function zoomAt(v: View, factor: number, point: { x: number; y: number }, fitted: Size, stage: Size): View {
  const scale = Math.max(1, Math.min(MAX_SCALE, v.scale * factor))
  if (scale === 1) return FIT
  const k = scale / v.scale
  return clampView({ scale, x: point.x - (point.x - v.x) * k, y: point.y - (point.y - v.y) * k }, fitted, stage)
}

/** How much a wheel turn zooms: a trackpad pinch arrives as a wheel with ctrl held, in far smaller steps. */
export function wheelFactor(deltaY: number, pinch: boolean): number {
  return Math.exp(-deltaY * (pinch ? 0.01 : 0.0015))
}

/** The magnification at which one picture pixel is one screen pixel, or a modest step in if it already is. */
export function actualSize(natural: Size, fitted: Size): number {
  const full = fitted.w > 0 ? natural.w / fitted.w : 1
  return Math.max(2, Math.min(MAX_SCALE, full))
}
