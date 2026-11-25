// Pure: the window imports values from here, so nothing Node-only may come in.
import { z } from 'zod'

import { isSkipped, safeStem } from './boardNames.js'
import { BOARD_STATUSES, BoardError, BoardStatusSchema, ColumnIdSchema } from './boardSchema.js'

export const COLUMN_NAME_MAX = 60
export const COLUMNS_MAX = 24

export const ColumnNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(COLUMN_NAME_MAX)
  .refine((name) => !/[\r\n]/.test(name))

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
