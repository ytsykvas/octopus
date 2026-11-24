import { MessageSquare, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { BoardCard, CardPriority } from '@core/boardSchema.js'
import { KIND_COLORS } from '@core/workspaceKinds.js'

import type { CardDragProps } from '../../hooks/useBoardDrag.js'
import type { DropEdge } from '../../hooks/useDragReorder.js'
import { DropLine } from '../DropLine.js'
import { LETTERS } from '../projectTint.js'
import { PRIORITY_LOOKS } from './boardLabels.js'

export interface BoardCardTileProps {
  readonly card: BoardCard
  readonly open: boolean
  readonly onOpen: () => void
  readonly marks: React.JSX.Element | null
  readonly drag: CardDragProps
  readonly dropEdge: DropEdge | null
  readonly dragging: boolean
}

function PriorityMark({ priority }: { readonly priority: CardPriority }): React.JSX.Element {
  const { t } = useTranslation()
  const { icon: Icon, tone } = PRIORITY_LOOKS[priority]
  return (
    <Icon
      size={12}
      role="img"
      aria-label={t(`board.priorities.${priority}`)}
      className={`mt-[3px] shrink-0 ${tone}`}
    />
  )
}

/** The folder a loose card lies in, when it lies in one: a renamed status folder shows up here. */
function looseFolder(card: BoardCard): string | null {
  const slash = card.ref.indexOf('/')
  return card.loose && slash !== -1 ? card.ref.slice(0, slash) : null
}

export function BoardCardTile({
  card,
  open,
  onOpen,
  marks,
  drag,
  dropEdge,
  dragging
}: BoardCardTileProps): React.JSX.Element {
  const { t } = useTranslation()
  const { priority, tag } = card.meta
  // A file that is not UTF-8 has no header to read, so the two marks together add nothing.
  const warning = card.notText
    ? t('board.card.notText')
    : card.malformed
      ? t('board.card.malformed')
      : null
  const folder = looseFolder(card)
  const secondLine =
    folder !== null || tag !== undefined || marks !== null || card.comments > 0 || warning !== null

  return (
    <li
      {...drag}
      data-dragging={dragging ? 'true' : undefined}
      className={`relative ${dragging ? 'opacity-50' : ''}`}
    >
      {dropEdge !== null && <DropLine edge={dropEdge} />}
      <button
        type="button"
        onClick={onOpen}
        aria-current={open ? 'true' : undefined}
        className={`focus-ring hover:border-line-strong w-full rounded-[var(--radius-control)] border px-2.5 py-2 text-left ${open ? 'border-accent/50 bg-canvas' : 'border-line bg-surface'}`}
      >
        <span className="flex gap-2">
          {/* A spacer without a priority, so the titles of a column line up. */}
          {priority === undefined ? (
            <span aria-hidden className="w-3 shrink-0" />
          ) : (
            <PriorityMark priority={priority} />
          )}
          <span className="text-ink line-clamp-2 min-w-0 break-words">{card.title}</span>
        </span>
        {secondLine && (
          <span className="text-ink-faint mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-5 text-[11px]">
            {folder !== null && <span>{folder}</span>}
            {tag !== undefined && (
              <span
                className="font-medium"
                style={
                  {
                    '--project-color': `var(--project-${KIND_COLORS[tag]})`,
                    color: LETTERS
                  } as React.CSSProperties
                }
              >
                {t(`workspaces.kinds.${tag}.short`)}
              </span>
            )}
            {marks}
            {card.comments > 0 && (
              <span
                role="img"
                aria-label={t('board.card.comments', { count: card.comments })}
                className="flex items-center gap-0.5"
              >
                <MessageSquare aria-hidden size={11} />
                {card.comments}
              </span>
            )}
            {warning !== null && (
              <TriangleAlert size={11} role="img" aria-label={warning} className="text-warning" />
            )}
          </span>
        )}
      </button>
    </li>
  )
}
