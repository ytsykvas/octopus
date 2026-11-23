import { useTranslation } from 'react-i18next'

import type { BoardCard, BoardStatus } from '@core/boardSchema.js'

import { Placeholder } from '../Placeholder.js'
import { BoardCardTile } from './BoardCardTile.js'
import { STATUS_LABEL_KEYS } from './boardLabels.js'

export interface BoardColumnProps {
  readonly status: BoardStatus
  /** Already sorted: `cardsByStatus` sorts every column. */
  readonly cards: readonly BoardCard[]
}

export function BoardColumn({ status, cards }: BoardColumnProps): React.JSX.Element {
  const { t } = useTranslation()
  const label = t(`board.statuses.${STATUS_LABEL_KEYS[status]}`)
  const ordered = cards.filter((card) => card.meta.order !== undefined)
  const loose = cards.filter((card) => card.meta.order === undefined)

  return (
    <section
      aria-label={label}
      className="border-line flex min-h-0 w-[272px] shrink-0 flex-col border-r"
    >
      <header className="flex h-9 shrink-0 items-center gap-1.5 px-3">
        <h2 className="section-label">{label}</h2>
        <span className="text-ink-faint text-[11px] tabular-nums">{cards.length}</span>
      </header>
      {cards.length === 0 ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <Placeholder compact art={false} title={t('board.empty.columnTitle')}>
            {t('board.empty.columnText')}
          </Placeholder>
        </div>
      ) : (
        <ul
          aria-label={label}
          className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2"
        >
          {ordered.map((card) => (
            <BoardCardTile key={card.ref} card={card} />
          ))}
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
          {loose.map((card) => (
            <BoardCardTile key={card.ref} card={card} />
          ))}
        </ul>
      )}
    </section>
  )
}
