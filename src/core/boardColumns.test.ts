import { describe, expect, it } from 'vitest'

import {
  type Column,
  columnKey,
  ColumnNameSchema,
  ColumnsSchema,
  COLUMN_NAME_MAX,
  COLUMNS_MAX,
  DEFAULT_COLUMNS,
  isColumnFolder,
  missingColumn
} from './boardColumns.js'
import { BoardError } from './boardSchema.js'

const custom = (id: string, name = id): Column => ({ kind: 'custom', id, name })

describe('columnKey', () => {
  it.each([
    ['backlog', 'backlog'],
    ['Backlog', 'backlog'],
    ['In Progress', 'in progress'],
    ['in-progress', 'in progress'],
    ['IN_PROGRESS', 'in progress'],
    ['in  progress ', 'in progress'],
    ['in--progress', 'in progress'],
    ['Code review', 'code review']
  ])('%j → %j', (id, expected) => {
    expect(columnKey(id)).toBe(expected)
  })
})

describe('isColumnFolder', () => {
  it.each([
    ['Code review', true],
    ['Ідеї', true],
    ['a/b', false],
    ['..', false],
    [' Ideas', false],
    ['_drafts', false],
    ['notes.tmp', false]
  ])('%j → %s', (id, expected) => {
    expect(isColumnFolder(id)).toBe(expected)
  })
})

describe('ColumnNameSchema', () => {
  it('trims a name', () => {
    expect(ColumnNameSchema.parse('  Review  ')).toBe('Review')
  })

  it.each([[''], ['   '], ['Two\nlines'], ['x'.repeat(COLUMN_NAME_MAX + 1)]])(
    'refuses %j',
    (name) => {
      expect(ColumnNameSchema.safeParse(name).success).toBe(false)
    }
  )
})

describe('ColumnsSchema', () => {
  it('takes the six built in', () => {
    expect(ColumnsSchema.parse(DEFAULT_COLUMNS)).toEqual(DEFAULT_COLUMNS)
  })

  it('takes added columns in any place', () => {
    const columns = [custom('Ideas'), ...DEFAULT_COLUMNS, custom('Code review', 'Review')]
    expect(ColumnsSchema.parse(columns)).toEqual(columns)
  })

  it('refuses a list without one of the six', () => {
    expect(ColumnsSchema.safeParse(DEFAULT_COLUMNS.slice(1)).success).toBe(false)
  })

  it('refuses two columns of one folder', () => {
    expect(
      ColumnsSchema.safeParse([...DEFAULT_COLUMNS, custom('Ideas'), custom('IDEAS')]).success
    ).toBe(false)
  })

  it('refuses an added column on a built-in folder', () => {
    expect(ColumnsSchema.safeParse([...DEFAULT_COLUMNS, custom('Done')]).success).toBe(false)
  })

  it('refuses an added column whose id is not a plain folder name', () => {
    expect(ColumnsSchema.safeParse([...DEFAULT_COLUMNS, custom('../x', 'X')]).success).toBe(false)
  })

  it(`refuses more than ${String(COLUMNS_MAX)} columns`, () => {
    const extra = Array.from({ length: COLUMNS_MAX - DEFAULT_COLUMNS.length + 1 }, (_, n) =>
      custom(`Column ${String(n)}`)
    )
    expect(ColumnsSchema.safeParse([...DEFAULT_COLUMNS, ...extra]).success).toBe(false)
  })
})

describe('missingColumn', () => {
  it('names the column', () => {
    const error = missingColumn('Ideas')
    expect(error).toBeInstanceOf(BoardError)
    expect(error).toMatchObject({ code: 'columnMissing', params: { id: 'Ideas' } })
  })
})
