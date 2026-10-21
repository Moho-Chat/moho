import type { FormatKind } from './composeFormat'

/** Colours reach a style attribute, so only a plain hex value gets there. */
const HEX = /^#[0-9a-fA-F]{6}$/

const isRun = (node: Node | null): node is HTMLElement => node instanceof HTMLElement && node.dataset.fmt !== undefined
const isKind = (node: Node | null, kind: FormatKind): node is HTMLElement => isRun(node) && node.dataset.fmt === kind
const isMarker = (node: Node | null): boolean => node instanceof HTMLElement && node.dataset.mark !== undefined
const sameRun = (a: HTMLElement, b: HTMLElement): boolean => a.dataset.fmt === b.dataset.fmt && a.dataset.color === b.dataset.color

function nearestRun(from: Node, root: Node, kind: FormatKind): HTMLElement | null {
  for (let n: Node | null = from.parentNode; n && n !== root; n = n.parentNode) {
    if (isKind(n, kind)) return n
  }
  return null
}

function marker(which: 's' | 'e'): HTMLElement {
  const m = document.createElement('i')
  m.dataset.mark = which
  return m
}

/**
 * Takes a marker out of every run of `kind` around it, splitting each run in
 * two at the marker. A start marker ends up in front of the second half and
 * an end marker behind the first, so what lies between the two markers is
 * never inside a run that reaches beyond it.
 */
function lift(root: Node, point: HTMLElement, kind: FormatKind, atStart: boolean): void {
  for (let run = nearestRun(point, root, kind); run; run = nearestRun(point, root, kind)) {
    const rest = document.createRange()
    if (atStart) rest.setStartBefore(point)
    else rest.setStartAfter(point)
    rest.setEnd(run, run.childNodes.length)
    const tail = run.cloneNode(false) as HTMLElement
    tail.append(rest.extractContents())
    run.after(tail)
    if (atStart) tail.before(point)
    else run.after(point)
  }
}

/** Every text node under `node`, in document order. */
export function textNodes(node: Node, into: Text[] = []): Text[] {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) into.push(child as Text)
    else textNodes(child, into)
  }
  return into
}

/** Text between two markers, in document order. */
function textBetween(root: Node, from: Node, to: Node): Text[] {
  return textNodes(root).filter(
    (n) =>
      n.nodeValue &&
      from.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING &&
      to.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING
  )
}

function charactersBefore(root: Node, point: Node): number {
  return textNodes(root).reduce((sum, n) => sum + (point.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING ? n.nodeValue!.length : 0), 0)
}

/** The point in the text that `count` characters in: a start prefers the beginning of the next piece, an end the finish of the last. */
function place(root: Node, count: number, atStart: boolean): [Node, number] {
  const text = textNodes(root)
  let seen = 0
  for (const n of text) {
    const length = n.nodeValue!.length
    if (atStart ? count < seen + length : count <= seen + length) return [n, count - seen]
    seen += length
  }
  const last = text[text.length - 1]
  return last ? [last, last.nodeValue!.length] : [root, 0]
}

function unwrap(run: HTMLElement): void {
  run.replaceWith(...Array.from(run.childNodes))
}

/** Splits leave runs and wrappers with nothing in them; they would serialise as stray markers. */
function dropEmpty(parent: Node): void {
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === 3) {
      if (!child.nodeValue) child.remove()
    } else if (child instanceof HTMLElement && !isMarker(child)) {
      dropEmpty(child)
      if (!child.hasChildNodes() && child.nodeName !== 'BR' && child.nodeName !== 'IMG') child.remove()
    }
  }
}

/** Two runs of one format side by side are one run, or they would be marked up twice. Markers between them stay in order. */
function mergeRuns(parent: Node): void {
  let child = parent.firstChild
  while (child) {
    if (isRun(child)) {
      const between: Node[] = []
      let next = child.nextSibling
      while (next && (isMarker(next) || (next.nodeType === 3 && !next.nodeValue))) {
        between.push(next)
        next = next.nextSibling
      }
      if (isRun(next) && sameRun(child, next)) {
        child.append(...between, ...Array.from(next.childNodes))
        next.remove()
        continue
      }
    }
    child = child.nextSibling
  }
  for (const element of Array.from(parent.childNodes)) if (element instanceof HTMLElement && !isMarker(element)) mergeRuns(element)
}

/**
 * The selection of `range` with `kind` put on - or taken off, if all of it
 * already has it. Works on `root` (a copy of the box, in practice) and
 * leaves `range` on the same text afterwards. False when there was nothing
 * to do.
 *
 * Applying over text that is part bold makes all of it bold, once, and
 * taking it off from the middle of a run leaves the rest of the run as it was;
 * both come from cutting every run of the kind at the selection's ends first.
 */
export function transformFormat(root: HTMLElement, range: Range, kind: FormatKind, colour?: string): boolean {
  if (kind === 'color' && colour && !HEX.test(colour)) return false
  const start = marker('s')
  const end = marker('e')
  const atEnd = range.cloneRange()
  atEnd.collapse(false)
  atEnd.insertNode(end)
  const atStart = range.cloneRange()
  atStart.collapse(true)
  atStart.insertNode(start)

  const leave = (done: boolean): boolean => {
    start.remove()
    end.remove()
    return done
  }
  if (textBetween(root, start, end).length === 0) return leave(false)

  lift(root, end, kind, false)
  lift(root, start, kind, true)

  const text = textBetween(root, start, end)
  const runs = Array.from(root.querySelectorAll<HTMLElement>(`[data-fmt="${kind}"]`)).filter(
    (run) => start.compareDocumentPosition(run) & Node.DOCUMENT_POSITION_FOLLOWING && end.compareDocumentPosition(run) & Node.DOCUMENT_POSITION_PRECEDING
  )
  const covered = text.every((t) => {
    for (let n: Node | null = t.parentNode; n && n !== root; n = n.parentNode) if (isKind(n, kind)) return true
    return false
  })

  if (kind === 'color' && !colour) {
    if (runs.length === 0) return leave(false)
  }
  // A colour is never toggled by choosing it again: a different one replaces.
  const off = kind === 'color' ? !colour : covered
  for (const run of runs) unwrap(run)
  if (!off) {
    const around = document.createRange()
    around.setStartAfter(start)
    around.setEndBefore(end)
    const span = document.createElement('span')
    span.dataset.fmt = kind
    if (kind === 'color' && colour) {
      span.dataset.color = colour
      span.style.color = colour
    }
    span.append(around.extractContents())
    around.insertNode(span)
  }

  dropEmpty(root)
  mergeRuns(root)

  // The markers say where the selection was, as a count of characters; the
  // text nodes are about to be joined, and a count survives that.
  const from = charactersBefore(root, start)
  const to = charactersBefore(root, end)
  start.remove()
  end.remove()
  root.normalize()
  range.setStart(...place(root, from, true))
  range.setEnd(...place(root, to, false))
  return true
}

/** Where a point in the box is, by child positions from the box down, so it can be found again in a copy. */
function pathOf(root: Node, node: Node, offset: number): number[] {
  const path = [offset]
  for (let n: Node = node; n !== root; n = n.parentNode as Node) {
    path.unshift(Array.prototype.indexOf.call((n.parentNode as Node).childNodes, n))
  }
  return path
}

function resolve(root: Node, path: number[]): [Node, number] {
  let node = root
  for (const index of path.slice(0, -1)) node = node.childNodes[index]
  return [node, path[path.length - 1]]
}

/**
 * Applies a format to what is selected in the box, or takes it off again if
 * all of the selection already has it. Returns whether it did anything.
 *
 * The change is worked out on a copy of the box and put back by replacing the
 * box's contents with one `insertHTML`, so it is a single step of the box's
 * own undo - and so the browser's habit of keeping the formatting of what a
 * replacement lands in cannot put back a format that was just taken off.
 */
export function applyFormat(root: HTMLElement, kind: FormatKind, colour?: string): boolean {
  const before = root.innerHTML
  const beforeSelection = currentSelection(root)
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false
  const picked = selection.getRangeAt(0)
  if (picked.collapsed || !root.contains(picked.commonAncestorContainer)) return false
  root.focus()

  const copy = root.cloneNode(true) as HTMLElement
  const range = document.createRange()
  range.setStart(...resolve(copy, pathOf(root, picked.startContainer, picked.startOffset)))
  range.setEnd(...resolve(copy, pathOf(root, picked.endContainer, picked.endOffset)))
  if (!transformFormat(copy, range, kind, colour)) return false

  const start = pathOf(copy, range.startContainer, range.startOffset)
  const end = pathOf(copy, range.endContainer, range.endOffset)
  selection.selectAllChildren(root)
  document.execCommand('insertHTML', false, copy.innerHTML)

  // Left selected, so another format can be stacked on without selecting again.
  select(root, { start, end })
  if (beforeSelection) remember({ before, beforeSelection, after: root.innerHTML, afterSelection: { start, end } })
  return true
}

interface Picked {
  start: number[]
  end: number[]
}

/** What the box held and had selected either side of a format, so undo and redo can put the selection back. */
interface Edit {
  before: string
  beforeSelection: Picked
  after: string
  afterSelection: Picked
}

const edits: Edit[] = []

function remember(edit: Edit): void {
  edits.push(edit)
  if (edits.length > 100) edits.shift()
}

function currentSelection(root: HTMLElement): Picked | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  return { start: pathOf(root, range.startContainer, range.startOffset), end: pathOf(root, range.endContainer, range.endOffset) }
}

function select(root: HTMLElement, picked: Picked): void {
  const selection = window.getSelection()
  if (!selection) return
  try {
    const range = document.createRange()
    range.setStart(...resolve(root, picked.start))
    range.setEnd(...resolve(root, picked.end))
    selection.removeAllRanges()
    selection.addRange(range)
  } catch {
    /* the contents are not built the way they were; the caret is wherever the browser left it */
  }
}

/**
 * Undo and redo step over a format as the whole box being replaced, and the
 * browser leaves everything selected afterwards - where the next key typed
 * would replace the message. Called after either, this puts back the
 * selection that was there at that point, when the box holds exactly what it
 * held then.
 */
export function restoreSelectionAfterHistory(root: HTMLElement, inputType: string): void {
  const undo = inputType === 'historyUndo'
  if (!undo && inputType !== 'historyRedo') return
  const now = root.innerHTML
  for (let i = edits.length - 1; i >= 0; i--) {
    const edit = edits[i]
    if ((undo ? edit.before : edit.after) === now) {
      select(root, undo ? edit.beforeSelection : edit.afterSelection)
      return
    }
  }
}
