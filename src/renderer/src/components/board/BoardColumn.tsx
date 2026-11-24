import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { type BoardCard, type BoardStatus, CARD_TITLE_MAX } from '@core/boardSchema.js'

import type { BoardDrag } from '../../hooks/useBoardDrag.js'
import { DropLine } from '../DropLine.js'
import { NameEditor } from '../NameEditor.js'
import { IconButton } from '../paneControls.js'
import { Placeholder } from '../Placeholder.js'
import { BoardCardTile } from './BoardCardTile.js'
import { STATUS_LABEL_KEYS } from './boardLabels.js'

export interface BoardColumnProps {
  readonly status: BoardStatus
  /** Already sorted: `cardsByStatus` sorts every column. */
  readonly cards: readonly BoardCard[]
  /** The cards of this status before the filter: `cards` may be a part of them. */
  readonly total: number
  readonly filtering: boolean
  readonly creating: boolean
  readonly onCreating: (creating: boolean) => void
  readonly onCreate: (title: string) => void
  readonly openRef: string | null
  readonly onOpen: (ref: string) => void
  readonly marksOf: (card: BoardCard) => React.JSX.Element | null
  readonly drag: BoardDrag
}

export function BoardColumn({
  status,
  cards,
  total,
  filtering,
  creating,
  onCreating,
  onCreate,
  openRef,
  onOpen,
  marksOf,
  drag
}: BoardColumnProps): React.JSX.Element {
  const { t } = useTranslation()
  const label = t(`board.statuses.${STATUS_LABEL_KEYS[status]}`)
  const ordered = cards.filter((card) => card.meta.order !== undefined)
  const loose = cards.filter((card) => card.meta.order === undefined)
  const tile = (card: BoardCard): React.JSX.Element => (
    <BoardCardTile
      key={card.ref}
      card={card}
      open={card.ref === openRef}
      onOpen={() => {
        onOpen(card.ref)
      }}
      marks={marksOf(card)}
      drag={drag.cardProps(card.ref, status)}
      dropEdge={drag.dropEdge(card.ref)}
      dragging={drag.draggingRef === card.ref}
    />
  )

  return (
    <section
      aria-label={label}
      className="border-line flex min-h-0 w-[272px] shrink-0 flex-col border-r"
      {...drag.columnProps(status)}
    >
      <header className="flex h-9 shrink-0 items-center gap-1.5 px-3">
        <h2 className="section-label">{label}</h2>
        <span className="text-ink-faint text-[11px] tabular-nums">
          {filtering ? t('board.column.count', { shown: cards.length, total }) : cards.length}
        </span>
        <span className="ml-auto">
          <IconButton
            label={t('board.column.newTask')}
            onClick={() => {
              onCreating(true)
            }}
          >
            <Plus aria-hidden size={14} />
          </IconButton>
        </span>
      </header>
      {cards.length === 0 && !creating ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          {drag.overColumn === status && <DropLine edge="above" />}
          <Placeholder compact art={false} title={t('board.empty.columnTitle')}>
            {total === 0 ? t('board.empty.columnText') : t('board.empty.filteredText')}
          </Placeholder>
        </div>
      ) : (
        <ul
          aria-label={label}
          className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2"
        >
          {creating && (
            <li>
              <NameEditor
                initial=""
                placeholder={t('board.column.newTaskPlaceholder')}
                maxLength={CARD_TITLE_MAX}
                onCommit={(title) => {
                  onCreating(false)
                  onCreate(title)
                }}
                onCancel={() => {
                  onCreating(false)
                }}
              />
            </li>
          )}
          {ordered.map(tile)}
          {ordered.length > 0 && loose.length > 0 && (
            <li
              role="separator"
              aria-label={t('board.column.byName')}
              className="text-ink-faint flex items-center gap-2 py-0.5 text-[11px]"
            >
              <span aria-hidden className="bg-line h-px flex-1" />
              {t('board.column.byName')}
              <span aria-hidden className="bg-line h-px flex-1" />
            </li>
          )}
          {loose.map(tile)}
        </ul>
      )}
    </section>
  )
}
