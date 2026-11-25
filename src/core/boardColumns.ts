// Pure: the window imports values from here, so nothing Node-only may come in.
import { z } from 'zod'

import { isSkipped, safeStem } from './boardNames.js'
import { BOARD_STATUSES, BoardError, BoardStatusSchema, ColumnIdSchema } from './boardSchema.js'
import { inOrder } from './lists.js'

export const COLUMN_NAME_MAX = 60
export const COLUMNS_MAX = 24

export const ColumnNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(COLUMN_NAME_MAX)
  .refine((name) => !/[\r\n]/.test(name))

export function isColumnName(name: string): boolean {
  return ColumnNameSchema.safeParse(name).success
}

export function columnKey(id: string): string {
  return id.normalize('NFC').toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

// A custom id is a folder name: anything `safeStem` would change could lead a write out of the board.
export function isColumnFolder(id: string): boolean {
  return safeStem(id, '') === id && !isSkipped(id)
}

export const ColumnSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('system'), id: BoardStatusSchema }),
  z.strictObject({
    kind: z.literal('custom'),
    id: ColumnIdSchema.refine(isColumnFolder),
    name: ColumnNameSchema
  })
])
export type Column = z.infer<typeof ColumnSchema>
export type CustomColumn = Extract<Column, { kind: 'custom' }>

function isWhole(columns: readonly Column[]): boolean {
  const keys = columns.map((column) => columnKey(column.id))
  return (
    new Set(keys).size === keys.length && BOARD_STATUSES.every((status) => keys.includes(status))
  )
}

export const ColumnsSchema = z.array(ColumnSchema).max(COLUMNS_MAX).refine(isWhole)

export const DEFAULT_COLUMNS: readonly Column[] = BOARD_STATUSES.map((id) => ({
  kind: 'system',
  id
}))

export function missingColumn(id: string): BoardError {
  return new BoardError('columnMissing', { id }, `The board has no column ${id}`)
}

export const ColumnEditSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('add'), name: ColumnNameSchema }),
  z.strictObject({ kind: z.literal('rename'), id: ColumnIdSchema, name: ColumnNameSchema }),
  z.strictObject({ kind: z.literal('remove'), id: ColumnIdSchema }),
  z.strictObject({ kind: z.literal('reorder'), ids: z.array(ColumnIdSchema).max(COLUMNS_MAX) })
])
export type ColumnEdit = z.infer<typeof ColumnEditSchema>

export interface BoardColumnSet {
  readonly columns: readonly Column[]
  readonly own: boolean
}

// A built-in column is named by the window in its language; English is what the core can compare.
function labelKey(column: Column): string {
  return columnKey(column.kind === 'system' ? column.id : column.name)
}

function assertNameFree(columns: readonly Column[], name: string, self: Column | null): void {
  if (columns.some((column) => column !== self && labelKey(column) === columnKey(name)))
    throw new BoardError('columnNameTaken', { name }, `A column is already called ${name}`)
}

function freeFolder(columns: readonly Column[], name: string): string {
  const stem = safeStem(name, 'Column')
  const taken = (id: string): boolean =>
    isSkipped(id) || columns.some((column) => columnKey(column.id) === columnKey(id))
  let id = stem
  for (let n = 2; taken(id); n += 1) id = `${stem} ${String(n)}`
  return id
}

function customColumn(columns: readonly Column[], id: string): CustomColumn {
  const column = columns.find((entry) => entry.id === id)
  if (column === undefined) throw missingColumn(id)
  if (column.kind === 'system')
    throw new BoardError('columnBuiltIn', { id }, `The column ${id} is built in`)
  return column
}

export function editColumns(columns: readonly Column[], edit: ColumnEdit): Column[] {
  switch (edit.kind) {
    case 'add': {
      if (columns.length >= COLUMNS_MAX) {
        const max = String(COLUMNS_MAX)
        throw new BoardError('columnsFull', { max }, `A board holds at most ${max} columns`)
      }
      assertNameFree(columns, edit.name, null)
      return [...columns, { kind: 'custom', id: freeFolder(columns, edit.name), name: edit.name }]
    }
    case 'rename': {
      const column = customColumn(columns, edit.id)
      assertNameFree(columns, edit.name, column)
      return columns.map((entry) => (entry === column ? { ...column, name: edit.name } : entry))
    }
    case 'remove': {
      const column = customColumn(columns, edit.id)
      return columns.filter((entry) => entry !== column)
    }
    case 'reorder':
      return inOrder(columns, edit.ids)
  }
}
