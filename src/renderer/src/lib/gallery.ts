/**
 * The pictures and videos of the conversation on screen, in the order they
 * are read, so the viewer can step from one to the next.
 *
 * Each media element in the log registers itself here while it is mounted,
 * with a way to ask what the viewer should show for it. The viewer asks for
 * its neighbours by position in the page, which is the order somebody is
 * scrolling through them in - there is no second list to keep in step with
 * the log.
 */

type Source<T> = () => T

const registered = new Map<HTMLElement, Source<unknown>>()

/** Makes `el` one of the pictures the viewer can step through, until the returned call. */
export function registerMedia<T>(el: HTMLElement, source: Source<T>): () => void {
  registered.set(el, source)
  return () => {
    if (registered.get(el) === source) registered.delete(el)
  }
}

/** Where `el` sits among its neighbours in the same list, and what each shows. */
export function galleryAround<T>(el: HTMLElement | null): { items: Source<T>[]; index: number } | null {
  if (!el) return null
  // The same list only: a thread panel beside the log is another conversation.
  const scope = el.closest('.messagelist, .thread-pane') ?? document.body
  const inScope = [...registered.keys()].filter((e) => e.isConnected && scope.contains(e))
  inScope.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
  const index = inScope.indexOf(el)
  if (index < 0) return null
  return { items: inScope.map((e) => registered.get(e) as Source<T>), index }
}

/** The index one step on, or null at the end: the viewer does not wrap round. */
export function stepIndex(index: number, count: number, by: 1 | -1): number | null {
  const next = index + by
  return next < 0 || next >= count ? null : next
}
