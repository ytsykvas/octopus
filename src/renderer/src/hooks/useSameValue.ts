import { useState } from 'react'

/**
 * A value rebuilt on every render, handed back as the object it was last time
 * for as long as it reads the same.
 *
 * For what a pane derives from a list that grows — the answers by request, the
 * calls that were plans — and hands to rows that are memoised on it: rebuilt
 * from the list it is a new object on every append, and every row reading it
 * is redrawn for one line added at the end. Compared by `same`, which says
 * what "reads the same" means for the value in hand.
 *
 * Adjusted during render rather than in an effect, as React has state derived
 * from props done: an effect runs after the paint, and the rows would have
 * drawn once from the new object by then.
 */
export function useSameValue<T>(next: T, same: (kept: T, next: T) => boolean): T {
  const [kept, setKept] = useState(next)
  const current = same(kept, next) ? kept : next
  if (current !== kept) setKept(current)
  return current
}

/** Whether two maps hold the same keys with the same values, by identity. */
export function sameMap<K, V>(a: ReadonlyMap<K, V>, b: ReadonlyMap<K, V>): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const [key, value] of a) if (!b.has(key) || b.get(key) !== value) return false
  return true
}

/** Whether two sets hold the same members. */
export function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const member of a) if (!b.has(member)) return false
  return true
}
