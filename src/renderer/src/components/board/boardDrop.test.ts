import { describe, expect, it } from 'vitest'

import type { BoardCard, ColumnId } from '@core/boardSchema.js'

import { boardCard } from '../../test/board.js'
import {
  type BoardColumns,
  dropMark,
  edgeAt,
  isOwnPlace,
  landingSlot,
  statusOf
} from './boardDrop.js'

const card = (ref: string, status: ColumnId, order?: number): BoardCard =>
  boardCard({
    ref,
    status,
    title: ref,
    meta: { links: [], runs: [], ...(order === undefined ? {} : { order }) }
  })
const COLUMNS: BoardColumns = new Map([
  [
    'backlog',
    [card('a', 'backlog', 1), card('b', 'backlog', 2), card('u', 'backlog'), card('v', 'backlog')]
  ],
  ['in progress', [card('p', 'in progress', 1)]],
  ['testing', []],
  ['staging', [card('s', 'staging')]],
  ['done', []],
  ['blocked', []]
])

describe('edgeAt', () => {
  it.each([
    [5, { top: 0, height: 40 }, 'above'],
    [19.9, { top: 0, height: 40 }, 'above'],
    [20, { top: 0, height: 40 }, 'below'],
    [135, { top: 100, height: 40 }, 'below']
  ] as const)('puts %s in %o on the %s half', (clientY, rect, edge) => {
    expect(edgeAt(clientY, rect)).toBe(edge)
  })
})

describe('statusOf', () => {
  it('names the column a card is listed in', () => {
    expect(statusOf(COLUMNS, 'p')).toBe('in progress')
  })

  it('names none for a card in no column', () => {
    expect(statusOf(COLUMNS, 'x')).toBeNull()
  })
})

describe('landingSlot', () => {
  it.each([
    { dragging: 'a', status: 'backlog', over: { ref: 'b', edge: 'above' }, slot: 0 },
    { dragging: 'a', status: 'backlog', over: { ref: 'b', edge: 'below' }, slot: 1 },
    { dragging: 'a', status: 'backlog', over: { ref: 'u', edge: 'below' }, slot: 1 },
    { dragging: 'a', status: 'backlog', over: null, slot: 1 },
    { dragging: 'p', status: 'backlog', over: { ref: 'a', edge: 'above' }, slot: 0 },
    { dragging: 'p', status: 'backlog', over: { ref: 'b', edge: 'below' }, slot: 2 },
    { dragging: 'p', status: 'backlog', over: { ref: 'v', edge: 'above' }, slot: 2 },
    { dragging: 'a', status: 'testing', over: null, slot: 0 },
    { dragging: 'a', status: 'in progress', over: { ref: 'p', edge: 'below' }, slot: 1 },
    { dragging: 'a', status: 'in progress', over: { ref: 'gone', edge: 'below' }, slot: 1 }
  ] as const)(
    '$dragging over $over in $status lands at $slot',
    ({ dragging, status, over, slot }) => {
      expect(landingSlot(COLUMNS, dragging, status, over)).toBe(slot)
    }
  )
})

describe('isOwnPlace', () => {
  it.each([
    { dragging: 'a', status: 'backlog', slot: 0, own: true },
    { dragging: 'a', status: 'backlog', slot: 1, own: false },
    { dragging: 'b', status: 'backlog', slot: 1, own: true },
    { dragging: 'u', status: 'backlog', slot: 2, own: false },
    { dragging: 'a', status: 'in progress', slot: 0, own: false },
    { dragging: 'p', status: 'in progress', slot: 0, own: true },
    { dragging: 's', status: 'staging', slot: 0, own: true }
  ] as const)(
    '$dragging at $slot of $status is its own place: $own',
    ({ dragging, status, slot, own }) => {
      expect(isOwnPlace(COLUMNS, dragging, status, slot)).toBe(own)
    }
  )
})

describe('dropMark', () => {
  it.each([
    { dragging: 'a', status: 'backlog', slot: 0, mark: null },
    { dragging: 'a', status: 'backlog', slot: 1, mark: { kind: 'card', ref: 'b', edge: 'below' } },
    { dragging: 'p', status: 'backlog', slot: 0, mark: { kind: 'card', ref: 'a', edge: 'above' } },
    { dragging: 'p', status: 'backlog', slot: 2, mark: { kind: 'card', ref: 'b', edge: 'below' } },
    { dragging: 'a', status: 'backlog', slot: 9, mark: { kind: 'card', ref: 'v', edge: 'below' } },
    { dragging: 'a', status: 'testing', slot: 0, mark: { kind: 'column', status: 'testing' } },
    { dragging: 'p', status: 'in progress', slot: 0, mark: null }
  ] as const)(
    '$dragging at $slot of $status is marked $mark',
    ({ dragging, status, slot, mark }) => {
      expect(dropMark(COLUMNS, dragging, status, slot)).toEqual(mark)
    }
  )
})
