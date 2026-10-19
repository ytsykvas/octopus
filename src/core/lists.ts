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
