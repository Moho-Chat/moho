import type { MenuEntry } from '../components/ContextMenu'

/**
 * The picture under the last right click, wherever it was.
 *
 * Every menu in the app is opened by a `contextmenu` event, and a picture is
 * the same picture whichever menu it opens - so rather than each place that
 * draws pictures offering to copy them, the one thing that sees every
 * right click remembers what was under it, and the menu adds the entry.
 */
let last: { img: HTMLImageElement; at: number } | null = null

/** How long after the click a menu still counts as being for it. */
const FRESH_MS = 400

export function watchRightClicks(): () => void {
  const on = (e: MouseEvent): void => {
    const t = e.target
    const img = t instanceof HTMLImageElement ? t : t instanceof Element ? t.closest('img') : null
    last = img && img.currentSrc ? { img, at: Date.now() } : null
  }
  // Capture, so it runs before anything that stops the event.
  document.addEventListener('contextmenu', on, true)
  return () => document.removeEventListener('contextmenu', on, true)
}

/** The picture the menu being opened right now is for, if any. */
export function pictureUnderMenu(): HTMLImageElement | null {
  return last && Date.now() - last.at < FRESH_MS && document.contains(last.img) ? last.img : null
}

/**
 * Puts a picture on the clipboard: from its pixels where the page may read
 * them, and from where it lives where it may not (a remote image taints the
 * canvas).
 */
export async function copyPicture(img: HTMLImageElement): Promise<{ error?: string }> {
  let pixels: string | undefined
  try {
    if (img.naturalWidth) {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d')?.drawImage(img, 0, 0)
      pixels = canvas.toDataURL('image/png')
    }
  } catch {
    pixels = undefined
  }
  try {
    return await window.moho.copyImage(img.currentSrc || img.src, pixels)
  } catch (e) {
    return { error: (e as Error).message }
  }
}

/** The entry that copies it. */
export function copyPictureEntry(img: HTMLImageElement, report: (message: string) => void): MenuEntry {
  return {
    label: 'Copy image',
    icon: 'content_copy',
    onClick: () => {
      void copyPicture(img).then((res) => report(res.error ? `Couldn't copy: ${res.error}` : 'Copied the picture'))
    }
  }
}
