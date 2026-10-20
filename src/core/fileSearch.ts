/**
 * Which files answer a query typed into the Files tab's filter.
 *
 * Pure and free of Node, so the window ranks with it directly: the tree already
 * holds every path it knows of, and asking the main process again per
 * keystroke would be a round trip for something the window can answer.
 */

/**
 * How well a path answers what has been typed, lower being better; null is no
 * match.
 *
 * Tiers in the order a reader expects: the file *is* called that, its name
 * starts with it, its name contains it, its path contains it, and finally the
 * letters appear in order somewhere in the path — which is what lets `cmpnt`
 * find `Component.tsx` without being a search engine.
 */
function rank(path: string, query: string): number | null {
  const lower = path.toLowerCase()
  const name = lower.slice(lower.lastIndexOf('/') + 1)

  if (name === query) return 0
  if (name.startsWith(query)) return 1
  if (name.includes(query)) return 2
  if (lower.includes(query)) return 3

  let from = 0
  for (const letter of query) {
    const found = lower.indexOf(letter, from)
    if (found === -1) return null
    from = found + 1
  }

  return 4
}

/**
 * The files worth offering for a query, best first.
 *
 * An empty query offers the shortest paths, which are the ones nearest the
 * root — a better guess at "what do you mean" than alphabetical order is. Ties
 * go to the shorter path and then to the name, so the same query always
 * answers in the same order and the list does not shuffle under the caret.
 */
export function rankFiles(paths: readonly string[], query: string, limit: number): string[] {
  const wanted = query.trim().toLowerCase()

  return paths
    .map((path) => ({ path, score: wanted === '' ? 0 : rank(path, wanted) }))
    .filter((scored): scored is { path: string; score: number } => scored.score !== null)
    .sort(
      (one, other) =>
        one.score - other.score ||
        one.path.length - other.path.length ||
        one.path.localeCompare(other.path)
    )
    .slice(0, limit)
    .map(({ path }) => path)
}
