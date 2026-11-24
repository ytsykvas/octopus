import type { BoardCard, CardPriority } from '@core/boardSchema.js'
import type { WorkspaceKind } from '@core/workspaceKinds.js'

import type { BoardColumns } from './boardDrop.js'

export type PriorityFilter = CardPriority | 'none'
export type TagFilter = WorkspaceKind | 'none'

export interface BoardFilter {
  readonly query: string
  readonly priorities: readonly PriorityFilter[]
  readonly tags: readonly TagFilter[]
}

export const EMPTY_BOARD_FILTER: BoardFilter = { query: '', priorities: [], tags: [] }

export function isFilterActive(filter: BoardFilter): boolean {
  return filter.query.trim() !== '' || filter.priorities.length > 0 || filter.tags.length > 0
}

export function queryWords(query: string): string[] {
  return query
    .normalize('NFC')
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '')
}

export function matchesFilter(
  card: BoardCard,
  filter: BoardFilter,
  tagLabel: (tag: WorkspaceKind) => string
): boolean {
  const { priority, tag } = card.meta
  if (filter.priorities.length > 0 && !filter.priorities.includes(priority ?? 'none')) return false
  if (filter.tags.length > 0 && !filter.tags.includes(tag ?? 'none')) return false
  // A line break between them: a word cannot start in the title and end in the tag.
  const text = `${card.title}\n${tag === undefined ? '' : tagLabel(tag)}`
    .normalize('NFC')
    .toLowerCase()
  return queryWords(filter.query).every((word) => text.includes(word))
}

/** The columns as the filter leaves them; the same object while no filter is on. */
export function filterColumns(
  columns: BoardColumns,
  filter: BoardFilter,
  tagLabel: (tag: WorkspaceKind) => string
): BoardColumns {
  if (!isFilterActive(filter)) return columns
  const keep = (cards: readonly BoardCard[]): BoardCard[] =>
    cards.filter((card) => matchesFilter(card, filter, tagLabel))
  // Spelled out rather than built with Object.fromEntries, which would need a cast:
  // a seventh status then fails to compile here instead of going missing.
  return {
    backlog: keep(columns.backlog),
    'in progress': keep(columns['in progress']),
    testing: keep(columns.testing),
    staging: keep(columns.staging),
    done: keep(columns.done),
    blocked: keep(columns.blocked)
  }
}
