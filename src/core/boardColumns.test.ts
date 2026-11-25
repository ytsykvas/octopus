import { describe, expect, it } from 'vitest'

import {
  type Column,
  ColumnEditSchema,
  columnKey,
  ColumnNameSchema,
  ColumnsSchema,
  COLUMN_NAME_MAX,
  COLUMNS_MAX,
  DEFAULT_COLUMNS,
  editColumns,
  isColumnFolder,
  isColumnName,
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

describe('isColumnName', () => {
  it.each([
    ['Review', true],
    ['  Review  ', true],
    ['', false],
    ['Two\nlines', false]
  ])('%j → %s', (name, expected) => {
    expect(isColumnName(name)).toBe(expected)
  })
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

describe('ColumnEditSchema', () => {
  it.each([
    [
      { kind: 'add', name: '  Review ' },
      { kind: 'add', name: 'Review' }
    ],
    [
      { kind: 'rename', id: 'Ideas', name: 'Thoughts' },
      { kind: 'rename', id: 'Ideas', name: 'Thoughts' }
    ],
    [
      { kind: 'remove', id: 'Ideas' },
      { kind: 'remove', id: 'Ideas' }
    ],
    [
      { kind: 'reorder', ids: ['done', 'backlog'] },
      { kind: 'reorder', ids: ['done', 'backlog'] }
    ]
  ])('takes %j', (edit, parsed) => {
    expect(ColumnEditSchema.parse(edit)).toEqual(parsed)
  })

  it.each([
    [{ kind: 'add', name: '' }],
    [{ kind: 'remove', id: '' }],
    [{ kind: 'reorder', ids: Array.from({ length: COLUMNS_MAX + 1 }, () => 'done') }],
    [{ kind: 'add', name: 'Review', extra: 1 }]
  ])('refuses %j', (edit) => {
    expect(ColumnEditSchema.safeParse(edit).success).toBe(false)
  })
})

describe('editColumns', () => {
  const ideas = custom('Ideas')
  const WITH_IDEAS: readonly Column[] = [...DEFAULT_COLUMNS, ideas]

  describe('add', () => {
    it('puts the new column last, in a folder named after it', () => {
      expect(editColumns(DEFAULT_COLUMNS, { kind: 'add', name: 'Code review' })).toEqual([
        ...DEFAULT_COLUMNS,
        custom('Code review')
      ])
    })

    it('leaves the list it was given as it was', () => {
      const columns = [...DEFAULT_COLUMNS]
      editColumns(columns, { kind: 'add', name: 'Review' })
      expect(columns).toEqual(DEFAULT_COLUMNS)
    })

    it('refuses the name of a built-in column, in any case', () => {
      expect(() => editColumns(DEFAULT_COLUMNS, { kind: 'add', name: 'In-Progress' })).toThrow(
        expect.objectContaining({ code: 'columnNameTaken', params: { name: 'In-Progress' } })
      )
    })

    it('refuses the name of an added column, in any case', () => {
      expect(() => editColumns(WITH_IDEAS, { kind: 'add', name: 'IDEAS' })).toThrow(
        expect.objectContaining({ code: 'columnNameTaken' })
      )
    })

    it("numbers the folder when another column's holds the name", () => {
      const renamed = [...DEFAULT_COLUMNS, custom('Ideas', 'Thoughts')]
      expect(editColumns(renamed, { kind: 'add', name: 'Ideas' }).at(-1)).toEqual(
        custom('Ideas 2', 'Ideas')
      )
    })

    it('numbers a folder the scan would skip', () => {
      expect(editColumns(DEFAULT_COLUMNS, { kind: 'add', name: 'Plan.tmp' }).at(-1)).toEqual(
        custom('Plan.tmp 2', 'Plan.tmp')
      )
    })

    it('makes a folder name of a name that has none', () => {
      expect(editColumns(DEFAULT_COLUMNS, { kind: 'add', name: '...' }).at(-1)).toEqual(
        custom('Column', '...')
      )
    })

    it('puts a name Finder cannot hold into a folder it can', () => {
      expect(editColumns(DEFAULT_COLUMNS, { kind: 'add', name: 'Ready / QA' }).at(-1)).toEqual(
        custom('Ready QA', 'Ready / QA')
      )
    })

    it(`refuses a column past ${String(COLUMNS_MAX)}`, () => {
      const full = [
        ...DEFAULT_COLUMNS,
        ...Array.from({ length: COLUMNS_MAX - DEFAULT_COLUMNS.length }, (_, n) =>
          custom(`Column ${String(n)}`)
        )
      ]
      expect(() => editColumns(full, { kind: 'add', name: 'One more' })).toThrow(
        expect.objectContaining({ code: 'columnsFull', params: { max: String(COLUMNS_MAX) } })
      )
      expect(editColumns(full.slice(1), { kind: 'add', name: 'One more' })).toHaveLength(
        COLUMNS_MAX
      )
    })
  })

  describe('rename', () => {
    it('changes the name and keeps the folder', () => {
      expect(editColumns(WITH_IDEAS, { kind: 'rename', id: 'Ideas', name: 'Thoughts' })).toEqual([
        ...DEFAULT_COLUMNS,
        custom('Ideas', 'Thoughts')
      ])
    })

    it('takes the name the column already has', () => {
      expect(editColumns(WITH_IDEAS, { kind: 'rename', id: 'Ideas', name: 'IDEAS' })).toEqual([
        ...DEFAULT_COLUMNS,
        custom('Ideas', 'IDEAS')
      ])
    })

    it("refuses another column's name", () => {
      expect(() => editColumns(WITH_IDEAS, { kind: 'rename', id: 'Ideas', name: 'Done' })).toThrow(
        expect.objectContaining({ code: 'columnNameTaken' })
      )
    })

    it('refuses a built-in column', () => {
      expect(() =>
        editColumns(WITH_IDEAS, { kind: 'rename', id: 'done', name: 'Shipped' })
      ).toThrow(expect.objectContaining({ code: 'columnBuiltIn', params: { id: 'done' } }))
    })

    it('refuses a column the list does not hold', () => {
      expect(() =>
        editColumns(DEFAULT_COLUMNS, { kind: 'rename', id: 'Ideas', name: 'X' })
      ).toThrow(expect.objectContaining({ code: 'columnMissing', params: { id: 'Ideas' } }))
    })
  })

  describe('remove', () => {
    it('takes an added column out', () => {
      expect(editColumns(WITH_IDEAS, { kind: 'remove', id: 'Ideas' })).toEqual(DEFAULT_COLUMNS)
    })

    it('refuses a built-in column', () => {
      expect(() => editColumns(WITH_IDEAS, { kind: 'remove', id: 'backlog' })).toThrow(
        expect.objectContaining({ code: 'columnBuiltIn' })
      )
    })

    it('refuses a column the list does not hold', () => {
      expect(() => editColumns(DEFAULT_COLUMNS, { kind: 'remove', id: 'Ideas' })).toThrow(
        expect.objectContaining({ code: 'columnMissing' })
      )
    })
  })

  describe('reorder', () => {
    it('puts every column, built in or added, in the order given', () => {
      const ids = ['Ideas', 'done', 'backlog', 'in progress', 'testing', 'staging', 'blocked']
      expect(editColumns(WITH_IDEAS, { kind: 'reorder', ids }).map((column) => column.id)).toEqual(
        ids
      )
    })

    it('keeps a column the order leaves out, after the rest', () => {
      expect(
        editColumns(WITH_IDEAS, { kind: 'reorder', ids: ['Ideas', 'gone'] }).map(
          (column) => column.id
        )
      ).toEqual(['Ideas', ...DEFAULT_COLUMNS.map((column) => column.id)])
    })
  })
})
