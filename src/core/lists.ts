/**
 * A list with one item in it or out of it, whatever it held before.
 *
 * The shape every switch over a stored list takes — a skill off by default, a
 * tip dismissed, a setting read from the checkout — written once, so the
 * operation is the same in the config and in a project. Idempotent on purpose:
 * the same answer given twice is still one entry.
 */
export function withMember<T>(list: readonly T[], item: T, member: boolean): T[] {
  // Left where it was when it already says so, rather than moved to the end:
  // the lists are drawn in their stored order.
  if (list.includes(item) === member) return [...list]
  return member ? [...list, item] : list.filter((entry) => entry !== item)
}

/**
 * The list with the item at `from` taken out and put back at `to` — a drag,
 * dropped.
 *
 * A copy whatever happens, and the list as it was for a position it does not
 * have: the window computes both indices from what it drew a moment ago, and a
 * list that changed under it must not throw in the middle of a drop.
 */
export function movedTo<T>(list: readonly T[], from: number, to: number): T[] {
  const outside = (index: number): boolean => index < 0 || index >= list.length
  if (from === to || outside(from) || outside(to)) return [...list]

  const next = [...list]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}
