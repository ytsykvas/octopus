import { BOARD_STATUSES, type BoardCard } from '@core/boardSchema.js'
import { present } from '@core/present.js'

import type { BoardColumns } from './boardDrop.js'

export type BoardDirection = 'up' | 'down' | 'left' | 'right'

export type BoardKeyAction =
  | { readonly kind: 'create'; readonly from: string | null }
  | { readonly kind: 'close'; readonly ref: string }
  | { readonly kind: 'blur'; readonly ref: string }
  | { readonly kind: 'focus'; readonly from: string | null; readonly direction: BoardDirection }
  | { readonly kind: 'step'; readonly ref: string; readonly step: -1 | 1 }
  | { readonly kind: 'remove'; readonly ref: string }

export interface BoardKeyContext {
  readonly focused: string | null
  readonly open: string | null
  /** Off while a filter hides cards (B206): the neighbours would be the wrong ones. */
  readonly reorderable: boolean
}

export type BoardKey = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

const DIRECTIONS = new Map<string, BoardDirection>([
  ['ArrowDown', 'down'],
  ['j', 'down'],
  ['ArrowUp', 'up'],
  ['k', 'up'],
  ['ArrowRight', 'right'],
  ['ArrowLeft', 'left']
])

export function boardKeyAction(
  event: BoardKey,
  { focused, open, reorderable }: BoardKeyContext
): BoardKeyAction | null {
  // Caps Lock gives `C` without Shift; Shift itself is ruled out by the modifier checks.
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  const target = focused ?? open
  const { metaKey, ctrlKey, altKey, shiftKey } = event
  if (!metaKey && !ctrlKey && !altKey && !shiftKey) return plainAction(key, focused, open)
  if (altKey && !metaKey && !ctrlKey && !shiftKey && reorderable && target !== null) {
    if (key === 'ArrowUp') return { kind: 'step', ref: target, step: -1 }
    if (key === 'ArrowDown') return { kind: 'step', ref: target, step: 1 }
    return null
  }
  if (metaKey && !ctrlKey && !altKey && !shiftKey && key === 'Backspace' && target !== null) {
    return { kind: 'remove', ref: target }
  }
  return null
}

function plainAction(
  key: string,
  focused: string | null,
  open: string | null
): BoardKeyAction | null {
  const target = focused ?? open
  const direction = DIRECTIONS.get(key)
  if (direction !== undefined) return { kind: 'focus', from: target, direction }
  if (key === 'c') return { kind: 'create', from: target }
  if (key !== 'Escape') return null
  if (open !== null) return { kind: 'close', ref: open }
  return focused === null ? null : { kind: 'blur', ref: focused }
}

export function cardRefs(columns: BoardColumns): string[][] {
  return BOARD_STATUSES.map((status) => columns[status].map((card) => card.ref))
}

export function nextFocus(
  columns: readonly (readonly string[])[],
  ref: string | null,
  direction: BoardDirection
): string | null {
  const first = columns.find((column) => column.length > 0)?.[0] ?? null
  if (ref === null) return first
  const at = columns.findIndex((column) => column.includes(ref))
  const column = columns[at]
  if (column === undefined) return first
  const index = column.indexOf(ref)
  if (direction === 'up') return column[index - 1] ?? ref
  if (direction === 'down') return column[index + 1] ?? ref
  const beyond = direction === 'right' ? columns.slice(at + 1) : columns.slice(0, at).reverse()
  const next = beyond.find((candidate) => candidate.length > 0)
  if (next === undefined) return ref
  return present(next[Math.min(index, next.length - 1)], 'a task in a column that has some')
}

export function stepIndex(
  column: readonly Pick<BoardCard, 'ref' | 'meta'>[],
  ref: string,
  step: -1 | 1
): number | null {
  const index = column.findIndex((card) => card.ref === ref)
  if (index === -1) return null
  if (step === -1) return index === 0 ? null : index - 1
  // Down only between ordered cards: orderForDrop cuts the index to the ordered part,
  // so a step past the last ordered one would write the same place again.
  const [card, next] = column.slice(index, index + 2)
  return card?.meta.order === undefined || next?.meta.order === undefined ? null : index + 1
}

/** The ref of the card button a key landed on; null on the body; undefined on any other control, whose key it is. */
export function focusedCard(target: EventTarget | null): string | null | undefined {
  if (target === document.body) return null
  return target instanceof HTMLElement ? target.dataset.cardRef : undefined
}
