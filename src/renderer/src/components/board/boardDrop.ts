import { dropSlot } from '@core/boardOrder.js'
import { BOARD_STATUSES, type BoardCard, type BoardStatus } from '@core/boardSchema.js'

import type { DropEdge } from '../../hooks/useDragReorder.js'

export type BoardColumns = Readonly<Record<BoardStatus, readonly BoardCard[]>>

/** A file from the Finder or dragged text carries no such type, and is refused. */
export const CARD_MIME = 'application/x-octopus-card'

export type DropMark =
  | { readonly kind: 'card'; readonly ref: string; readonly edge: DropEdge }
  | { readonly kind: 'column'; readonly status: BoardStatus }

/** Unused by the drag itself: B205 reads it for `C` and `⌥↑/⌥↓`. */
export function statusOf(columns: BoardColumns, ref: string): BoardStatus | null {
  return BOARD_STATUSES.find((status) => columns[status].some((card) => card.ref === ref)) ?? null
}

export function edgeAt(
  clientY: number,
  rect: { readonly top: number; readonly height: number }
): DropEdge {
  return clientY < rect.top + rect.height / 2 ? 'above' : 'below'
}

/** Counted without the dragged card and cut to the ordered part, as `orderForDrop` does in core. */
export function landingSlot(
  columns: BoardColumns,
  draggingRef: string,
  status: BoardStatus,
  over: { readonly ref: string; readonly edge: DropEdge } | null
): number {
  const without = columns[status].filter((card) => card.ref !== draggingRef)
  if (over === null) return dropSlot(without, without.length)
  const at = without.findIndex((card) => card.ref === over.ref)
  if (at === -1) return dropSlot(without, without.length)
  return dropSlot(without, over.edge === 'above' ? at : at + 1)
}

export function isOwnPlace(
  columns: BoardColumns,
  draggingRef: string,
  status: BoardStatus,
  slot: number
): boolean {
  const column = columns[status]
  const card = column.find((entry) => entry.ref === draggingRef)
  if (card === undefined) return false
  if (column.length === 1) return true
  // An unordered card is never in place: the drop writes it an order, which moves it.
  return card.meta.order !== undefined && column.indexOf(card) === slot
}

export function dropMark(
  columns: BoardColumns,
  draggingRef: string,
  status: BoardStatus,
  slot: number
): DropMark | null {
  if (isOwnPlace(columns, draggingRef, status, slot)) return null
  const without = columns[status].filter((card) => card.ref !== draggingRef)
  // Under the card before the slot, not over the one after: that keeps it above "By name".
  // Clamped, since a listing re-read mid-drag can leave the slot past the end.
  const above = slot > 0 ? without[Math.min(slot, without.length) - 1] : undefined
  if (above !== undefined) return { kind: 'card', ref: above.ref, edge: 'below' }
  const [first] = without
  return first === undefined
    ? { kind: 'column', status }
    : { kind: 'card', ref: first.ref, edge: 'above' }
}
