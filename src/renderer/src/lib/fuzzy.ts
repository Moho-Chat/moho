/**
 * Finding something in a list by a few of its letters.
 *
 * One matcher for the quick switcher and for every list long enough to want
 * searching (a friends list, #339), so "gk" finds Gaunt King the same way in
 * both: a word of the query matches a name exactly, at its start, at the start
 * of a word inside it, anywhere inside it, or - last - as its letters in order.
 */

/** Every character of `needle` in `hay`, in order. */
function subsequence(hay: string, needle: string): boolean {
  let at = 0
  for (const ch of needle) {
    at = hay.indexOf(ch, at)
    if (at < 0) return false
    at++
  }
  return true
}

/** How well one word of the query matches a title; 0 is not at all. Both already lower-case. */
export function wordScore(title: string, word: string): number {
  if (title === word) return 120
  if (title.startsWith(word)) return 100
  // At the start of a word inside it: "dev" in "moho-dev", "eagle" in "the eagles nest".
  if (new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(title)) return 80
  if (title.includes(word)) return 60
  if (subsequence(title, word)) return 30
  return 0
}

/**
 * The items that match what was typed, best first.
 *
 * `textsOf` gives what an item may be found by, most important first - a
 * display name, then a username. Every word typed has to match one of them;
 * a match in a later text counts for a little less than the same in an
 * earlier one. Nothing typed is everything, in the order given.
 */
export function fuzzyFilter<T>(items: T[], query: string, textsOf: (item: T) => string[]): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return items
  const hits: { item: T; score: number; at: number }[] = []
  items.forEach((item, at) => {
    const texts = textsOf(item).map((t) => t.toLowerCase())
    let total = 0
    for (const word of words) {
      let best = 0
      texts.forEach((text, rank) => {
        best = Math.max(best, wordScore(text, word) - rank * 5)
      })
      if (best <= 0) return
      total += best
    }
    hits.push({ item, score: total, at })
  })
  // Ties keep the order the list came in.
  return hits.sort((a, b) => b.score - a.score || a.at - b.at).map((h) => h.item)
}
