import { useTranslation } from 'react-i18next'

import {
  type Column,
  type ColumnEdit,
  type CustomColumn,
  isColumnName
} from '@core/boardColumns.js'

import { useAskText } from './useAskText.js'
import { useConfirm } from './useConfirm.js'
import { type DragReorder, useDragReorder } from './useDragReorder.js'

export interface ColumnEditing {
  readonly reorder: DragReorder
  readonly add: () => Promise<void>
  readonly rename: (column: CustomColumn) => Promise<void>
  readonly remove: (column: CustomColumn) => Promise<void>
  /** Render exactly once: without it, `add`, `rename` and `remove` never settle. */
  readonly dialogs: React.JSX.Element
}

export function useColumnEditing(
  columns: readonly Column[],
  edit: (edit: ColumnEdit) => Promise<unknown>
): ColumnEditing {
  const { t } = useTranslation()
  const { confirm, dialog } = useConfirm()
  const { ask, dialog: askDialog } = useAskText()
  const reorder = useDragReorder(
    columns.map((column) => column.id),
    (ids) => void edit({ kind: 'reorder', ids })
  )

  const askName = (title: string, confirmLabel: string, initial: string): Promise<string | null> =>
    ask({
      title,
      label: t('board.columns.name'),
      confirmLabel,
      cancelLabel: t('board.columns.cancel'),
      initial,
      valid: isColumnName,
      invalid: t('board.columns.nameInvalid')
    })

  const add = async (): Promise<void> => {
    const name = await askName(t('board.columns.addTitle'), t('board.columns.create'), '')
    if (name !== null) await edit({ kind: 'add', name })
  }

  const rename = async (column: CustomColumn): Promise<void> => {
    const name = await askName(t('board.columns.renameTitle'), t('board.columns.save'), column.name)
    if (name !== null) await edit({ kind: 'rename', id: column.id, name })
  }

  const remove = async (column: CustomColumn): Promise<void> => {
    const { confirmed } = await confirm({
      title: t('board.columns.removeTitle', { name: column.name }),
      message: t('board.columns.removeBody'),
      confirmLabel: t('board.columns.removeConfirm'),
      cancelLabel: t('board.columns.cancel'),
      destructive: true
    })
    if (confirmed) await edit({ kind: 'remove', id: column.id })
  }

  return {
    reorder,
    add,
    rename,
    remove,
    dialogs: (
      <>
        {dialog}
        {askDialog}
      </>
    )
  }
}
