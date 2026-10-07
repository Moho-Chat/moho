import type { FormatKind } from './composeFormat'

/** The nearest enclosing element in the box that stands for `kind`, if any. */
function holderOf(node: Node | null, root: HTMLElement, kind: FormatKind): HTMLElement | null {
  for (let n: Node | null = node; n && n !== root; n = n.parentNode) {
    if (n instanceof HTMLElement && n.dataset.fmt === kind) return n
  }
  return null
}

/** Colours reach a style attribute, so only a plain hex value gets there. */
const HEX = /^#[0-9a-fA-F]{6}$/

/**
 * Applies a format to what is selected in the box, or takes it off again if
 * the selection is exactly that format already. Returns whether it did
 * anything.
 *
 * Goes through `insertHTML` rather than rearranging nodes, so the box's own
 * undo still steps back over it.
 */
export function applyFormat(root: HTMLElement, kind: FormatKind, colour?: string): boolean {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false
  const range = selection.getRangeAt(0)
  if (range.collapsed || !root.contains(range.commonAncestorContainer)) return false
  root.focus()

  // The selection can be a whole formatted run (it is, right after one is
  // applied, so another can be stacked on), which names the run's parent as
  // its ancestor and the run itself only by position.
  const whole =
    range.startContainer === range.endContainer && range.endOffset - range.startOffset === 1
      ? range.startContainer.childNodes[range.startOffset]
      : null
  const holder = holderOf(whole ?? range.commonAncestorContainer, root, kind)
  if (holder && (kind === 'color' ? !colour : holder.textContent === range.toString())) {
    const around = document.createRange()
    around.selectNode(holder)
    selection.removeAllRanges()
    selection.addRange(around)
    document.execCommand('insertHTML', false, holder.innerHTML)
    return true
  }
  if (kind === 'color' && !(colour && HEX.test(colour))) return false

  const scratch = document.createElement('div')
  scratch.appendChild(range.cloneContents())
  const colourAttrs = kind === 'color' ? ` data-color="${colour}" style="color:${colour}"` : ''
  document.execCommand(
    'insertHTML',
    false,
    `<span data-fmt="${kind}"${colourAttrs} data-new="1">${scratch.innerHTML}</span>`
  )
  // Left selected, so another format can be stacked on without selecting again.
  const made = root.querySelector('[data-new]')
  if (made) {
    made.removeAttribute('data-new')
    // The run itself rather than its contents: Chromium replaces the whole
    // element when what is selected is all of what is inside it, which would
    // swallow the format just applied.
    const around = document.createRange()
    around.selectNode(made)
    selection.removeAllRanges()
    selection.addRange(around)
  }
  return true
}
