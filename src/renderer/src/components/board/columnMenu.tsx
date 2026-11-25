import type { TFunction } from 'i18next'
import { ArrowLeft, ArrowRight, Pencil, Trash2 } from 'lucide-react'

import type { Column } from '@core/boardColumns.js'

import type { ColumnEditing } from '../../hooks/useColumnEditing.js'
import type { MenuAction } from '../DropdownMenu.js'

export interface ColumnPlace {
  readonly index: number
  readonly count: number
  readonly cardCount: number
}

export function columnMenu(
  column: Column,
  { index, count, cardCount }: ColumnPlace,
  editing: ColumnEditing,
  t: TFunction
): MenuAction[] {
  const moves: MenuAction[] = [
    {
      id: 'left',
      label: t('board.columns.moveLeft'),
      icon: <ArrowLeft aria-hidden size={13} />,
      disabled: index === 0,
      onSelect: () => {
        editing.reorder.moveBy(column.id, -1)
      }
    },
    {
      id: 'right',
      label: t('board.columns.moveRight'),
      icon: <ArrowRight aria-hidden size={13} />,
      disabled: index === count - 1,
      onSelect: () => {
        editing.reorder.moveBy(column.id, 1)
      }
    }
  ]
  if (column.kind === 'system') return moves
  return [
    ...moves,
    {
      id: 'rename',
      label: t('board.columns.renameItem'),
      icon: <Pencil aria-hidden size={13} />,
      onSelect: () => void editing.rename(column)
    },
    {
      id: 'remove',
      label: t('board.columns.removeItem'),
      icon: <Trash2 aria-hidden size={13} />,
      destructive: true,
      disabled: cardCount > 0,
      ...(cardCount > 0 && { description: t('board.columns.removeBlocked') }),
      onSelect: () => void editing.remove(column)
    }
  ]
}
