import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useBoardColumns } from '../../hooks/useBoardColumns.js'
import { useColumnEditing } from '../../hooks/useColumnEditing.js'
import { columnLabel } from '../board/boardLabels.js'
import { Button } from '../Button.js'
import { DropLine } from '../DropLine.js'
import { Field } from '../Field.js'
import { ReorderHandle } from '../ReorderHandle.js'

export function ColumnsSection({
  projectId
}: {
  readonly projectId: string | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const columns = useBoardColumns(projectId)
  const list = columns.set?.columns ?? []
  const editing = useColumnEditing(list, columns.edit)
  const { reorder } = editing

  return (
    <Field
      label={t('board.columns.title')}
      hint={t(projectId === null ? 'board.columns.defaultHint' : 'board.columns.projectHint')}
    >
      <div className="max-w-lg space-y-3">
        {projectId !== null && columns.set !== null && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-ink-faint leading-relaxed">
              {t(columns.set.own ? 'board.columns.own' : 'board.columns.following')}
            </p>
            {columns.set.own && (
              <Button size="sm" onClick={() => void columns.reset(projectId)}>
                {t('board.columns.useDefault')}
              </Button>
            )}
          </div>
        )}

        {columns.error !== null && <p className="text-danger">{columns.error}</p>}

        <ul className="border-line divide-line divide-y rounded-[var(--radius-panel)] border">
          {list.map((column) => {
            const label = columnLabel(column, t)
            const dropEdge = reorder.dropEdge(column.id)

            return (
              <li
                key={column.id}
                aria-label={label}
                {...reorder.itemProps(column.id)}
                className={`relative flex items-center gap-2 px-3 py-1.5 ${
                  column.id === reorder.draggingId ? 'opacity-40' : ''
                }`}
              >
                <ReorderHandle
                  label={t('board.columns.reorderHandle', { name: label })}
                  onStep={(step) => {
                    reorder.moveBy(column.id, step)
                  }}
                />
                <span className="text-ink min-w-0 flex-1 truncate">{label}</span>
                {column.kind === 'system' ? (
                  <span
                    className="text-ink-faint text-[11px]"
                    title={t('board.columns.builtInHint')}
                  >
                    {t('board.columns.builtIn')}
                  </span>
                ) : (
                  <>
                    <Button
                      size="sm"
                      aria-label={t('board.columns.rename', { name: label })}
                      onClick={() => void editing.rename(column)}
                    >
                      <Pencil aria-hidden size={12} />
                    </Button>
                    <Button
                      size="sm"
                      aria-label={t('board.columns.remove', { name: label })}
                      onClick={() => void editing.remove(column)}
                    >
                      <Trash2 aria-hidden size={12} />
                    </Button>
                  </>
                )}
                {dropEdge !== null && <DropLine edge={dropEdge} />}
              </li>
            )
          })}
        </ul>

        <Button size="sm" onClick={() => void editing.add()}>
          <Plus aria-hidden size={12} />
          {t('board.columns.add')}
        </Button>
      </div>
      {editing.dialogs}
    </Field>
  )
}
