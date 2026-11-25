/**
 * Where a card sits in its column, decided on numbers.
 *
 * Pure: the window computes the order a drop writes before it asks for the move.
 */
import type { BoardCard, ColumnId } from './boardSchema.js'
import { compareNames } from './boardNames.js'

/** Anything with an optional `meta.order`: a card, or a test's two-field stand-in. Not exported. */
interface Ordered {
  readonly meta: { readonly order?: number | undefined }
}

const lastSegment = (ref: string): string => ref.slice(ref.lastIndexOf('/') + 1)

/** Unordered cards rank after every ordered one; `order` is always finite (zod refuses Infinity). */
const rank = (card: Ordered): number => card.meta.order ?? Infinity

export function orderBetween(before: number | null, after: number | null): number {
  if (before === null) return after === null ? 0 : after - 1
  return after === null ? before + 1 : (before + after) / 2
}

export function sortCards<T extends Ordered & { readonly ref: string }>(cards: readonly T[]): T[] {
  // Infinity - Infinity is NaN, which `||` passes over to the name: two unordered cards sort by name.
  return [...cards].sort(
    (a, b) => rank(a) - rank(b) || compareNames(lastSegment(a.ref), lastSegment(b.ref))
  )
}

export function columnCards<T extends BoardCard>(cards: readonly T[], status: ColumnId): T[] {
  return sortCards(cards.filter((card) => card.status === status))
}

// A Map, not a record: a record lists an integer-like id such as "2" first, out of the columns' order.
export function cardsByStatus<T extends BoardCard>(
  cards: readonly T[],
  columns: readonly { readonly id: ColumnId }[]
): Map<ColumnId, T[]> {
  return new Map(columns.map((column) => [column.id, columnCards(cards, column.id)]))
}

export function cardsIn<T>(
  columns: ReadonlyMap<ColumnId, readonly T[]>,
  id: ColumnId
): readonly T[] {
  return columns.get(id) ?? []
}

const orderedOf = (column: readonly Ordered[]): Ordered[] =>
  column.filter((card) => card.meta.order !== undefined)

export function dropSlot(column: readonly Ordered[], index: number): number {
  return Math.min(index, orderedOf(column).length)
}

export function orderForDrop(column: readonly Ordered[], index: number): number {
  const ordered = orderedOf(column)
  const slot = dropSlot(column, index)
  return orderBetween(ordered[slot - 1]?.meta.order ?? null, ordered[slot]?.meta.order ?? null)
}

export function firstOrder(column: readonly Ordered[]): number {
  return orderBetween(null, orderedOf(column)[0]?.meta.order ?? null)
}
