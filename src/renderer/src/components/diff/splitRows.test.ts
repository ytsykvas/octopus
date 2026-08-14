import { describe, expect, it } from 'vitest'

import type { DiffLine } from '@core/diff.js'

import { MIN_SPLIT_COLUMNS, splitThreshold } from './measure.js'
import { splitRows } from './splitRows.js'

const context = (text: string, number: number): DiffLine => ({
  kind: 'context',
  text,
  oldNumber: number,
  newNumber: number,
  noNewline: false
})

const removed = (text: string, oldNumber: number): DiffLine => ({
  kind: 'removed',
  text,
  oldNumber,
  newNumber: null,
  noNewline: false
})

const added = (text: string, newNumber: number): DiffLine => ({
  kind: 'added',
  text,
  oldNumber: null,
  newNumber,
  noNewline: false
})

describe('splitRows', () => {
  it('puts a context line on both sides, because it is the same line', () => {
    expect(splitRows([context('kept', 1)])).toEqual([
      { left: context('kept', 1), right: context('kept', 1) }
    ])
  })

  // The pairing is the whole reason to have two columns: without it a replaced
  // line reads as a deletion above an unrelated insertion.
  it('sets a removed line against the addition that replaced it', () => {
    expect(splitRows([removed('was', 2), added('is', 2)])).toEqual([
      { left: removed('was', 2), right: added('is', 2) }
    ])
  })

  it('pads the shorter side when more was added than removed', () => {
    const rows = splitRows([removed('one', 1), added('one', 1), added('two', 2)])

    expect(rows).toHaveLength(2)
    expect(rows[1]).toEqual({ left: null, right: added('two', 2) })
  })

  it('pads the shorter side when more was removed than added', () => {
    const rows = splitRows([removed('one', 1), removed('two', 2), added('one', 1)])

    expect(rows[1]).toEqual({ left: removed('two', 2), right: null })
  })

  it('leaves an addition alone when nothing was removed for it', () => {
    expect(splitRows([added('new', 1)])).toEqual([{ left: null, right: added('new', 1) }])
  })

  it('leaves a removal alone when nothing replaced it', () => {
    expect(splitRows([removed('gone', 1)])).toEqual([{ left: removed('gone', 1), right: null }])
  })

  it('keeps separate runs separate rather than pairing across context', () => {
    const rows = splitRows([
      removed('a', 1),
      added('A', 1),
      context('middle', 2),
      removed('b', 3),
      added('B', 3)
    ])

    expect(rows).toHaveLength(3)
    expect(rows[1]?.left).toEqual(context('middle', 2))
  })

  it('has nothing to pair in an empty hunk', () => {
    expect(splitRows([])).toEqual([])
  })
})

describe('splitThreshold', () => {
  it('asks for both columns, both gutters and the space between', () => {
    expect(splitThreshold(10, 50)).toBe(2 * (50 + MIN_SPLIT_COLUMNS * 10))
  })

  it('rounds up, so a threshold is never a fraction of a pixel short', () => {
    expect(splitThreshold(7.3, 11.5)).toBe(Math.ceil(2 * (11.5 + MIN_SPLIT_COLUMNS * 7.3)))
  })
})
