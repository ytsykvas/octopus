import { describe, expect, it } from 'vitest'

import {
  cardsByStatus,
  cardsIn,
  columnCards,
  dropSlot,
  firstOrder,
  orderBetween,
  orderForDrop,
  sortCards
} from './boardOrder.js'
import { DEFAULT_COLUMNS } from './boardColumns.js'
import type { BoardCard, ColumnId } from './boardSchema.js'

const card = (ref: string, order?: number): { ref: string; meta: { order?: number } } => ({
  ref,
  meta: order === undefined ? {} : { order }
})
const full = (ref: string, status: ColumnId, order: number): BoardCard => ({
  ref,
  status,
  loose: false,
  title: ref,
  malformed: false,
  notText: false,
  comments: 0,
  meta: { links: [], runs: [], order }
})
const a1 = card('backlog/a.md', 1)
const b2 = card('backlog/b.md', 2)
const a5 = card('backlog/a.md', 5)
const u = card('backlog/u.md')
const v = card('backlog/v.md')

const refs = (cards: readonly { ref: string }[]): string[] => cards.map((one) => one.ref)

describe('orderBetween', () => {
  it.each([
    [null, null, 0],
    [1, null, 2],
    [null, 1, 0],
    [1, 2, 1.5],
    [-3, -1, -2]
  ])('between %j and %j → %j', (before, after, expected) => {
    expect(orderBetween(before, after)).toBe(expected)
  })
})

describe('sortCards', () => {
  it('puts hand-ordered cards first and the rest by name', () => {
    const sorted = sortCards([
      card('backlog/b.md'),
      card('backlog/a.md'),
      card('backlog/z.md', 2),
      card('backlog/y.md', 1),
      card('backlog/x.md', 1)
    ])
    expect(refs(sorted)).toEqual([
      'backlog/x.md',
      'backlog/y.md',
      'backlog/z.md',
      'backlog/a.md',
      'backlog/b.md'
    ])
  })

  it('orders loose cards by their file name, not their folder', () => {
    expect(refs(sortCards([card('zeta/a.md'), card('b.md')]))).toEqual(['zeta/a.md', 'b.md'])
  })

  it('leaves the array it was given alone', () => {
    const given = [card('backlog/b.md'), card('backlog/a.md')]
    sortCards(given)
    expect(refs(given)).toEqual(['backlog/b.md', 'backlog/a.md'])
  })
})

describe('columnCards', () => {
  it("takes one column's cards, sorted", () => {
    expect(
      refs(
        columnCards(
          [
            full('done/b.md', 'done', 2),
            full('backlog/c.md', 'backlog', 0),
            full('done/a.md', 'done', 1)
          ],
          'done'
        )
      )
    ).toEqual(['done/a.md', 'done/b.md'])
  })
})

describe('cardsByStatus', () => {
  it('answers every column in its order, empty ones included', () => {
    expect([...cardsByStatus([], DEFAULT_COLUMNS).keys()]).toEqual([
      'backlog',
      'in progress',
      'testing',
      'staging',
      'done',
      'blocked'
    ])
  })

  it('groups and sorts each column', () => {
    const columns = cardsByStatus(
      [
        full('done/b.md', 'done', 2),
        full('done/a.md', 'done', 1),
        full('backlog/c.md', 'backlog', 0)
      ],
      DEFAULT_COLUMNS
    )
    expect(refs(cardsIn(columns, 'done'))).toEqual(['done/a.md', 'done/b.md'])
    expect(refs(cardsIn(columns, 'backlog'))).toEqual(['backlog/c.md'])
    expect(columns.get('in progress')).toEqual([])
  })

  it('leaves out a card whose column is not given', () => {
    const columns = cardsByStatus([full('Ideas/a.md', 'Ideas', 0)], [{ id: 'backlog' }])
    expect([...columns.values()].flat()).toEqual([])
  })
})

describe('cardsIn', () => {
  it('answers no cards for a column the map does not hold', () => {
    expect(cardsIn(new Map(), 'Ideas')).toEqual([])
  })
})

describe('orderForDrop', () => {
  it.each([
    [[], 0, 0],
    [[a1, b2], 0, 0],
    [[a1, b2], 1, 1.5],
    [[a1, b2], 2, 3],
    [[a1, u, v], 2, 2],
    [[u, v], 1, 0]
  ])('%j at %j → %j', (column, index, expected) => {
    expect(orderForDrop(column, index)).toBe(expected)
  })
})

describe('dropSlot', () => {
  it('stops at the last hand-ordered card', () => {
    expect(dropSlot([a1, u, v], 3)).toBe(1)
    expect(dropSlot([a1, b2], 1)).toBe(1)
  })
})

describe('firstOrder', () => {
  it.each([
    [[a5, u], 4],
    [[u], 0],
    [[], 0]
  ])('%j → %j', (column, expected) => {
    expect(firstOrder(column)).toBe(expected)
  })
})
