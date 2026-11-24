import { MessageSquare, TriangleAlert } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type BoardCard, CARD_TITLE_MAX, type CardPriority } from '@core/boardSchema.js'
import { KIND_COLORS } from '@core/workspaceKinds.js'

import type { CardDragProps } from '../../hooks/useBoardDrag.js'
import type { DropEdge } from '../../hooks/useDragReorder.js'
import { DropLine } from '../DropLine.js'
import { NameEditor } from '../NameEditor.js'
import { LETTERS } from '../projectTint.js'
import { PRIORITY_LOOKS } from './boardLabels.js'

export interface BoardCardTileProps {
  readonly card: BoardCard
  readonly open: boolean
  readonly onOpen: () => void
  readonly onRename: (title: string) => void
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

export const CARD_BOX = 'w-full rounded-[var(--radius-control)] border px-2.5 py-2 text-left'

/** The open card's fill: a new card opens once created, and a double-clicked one is already open. */
export const CARD_FIELD_BOX = `${CARD_BOX} border-accent bg-canvas`

/** A spacer without a priority, so the titles of a column line up. */
export function TitleLead({
  priority
}: {
  readonly priority?: CardPriority | undefined
}): React.JSX.Element {
  return priority === undefined ? (
    <span aria-hidden className="w-3 shrink-0" />
  ) : (
    <PriorityMark priority={priority} />
  )
}

export interface CardTitleFieldProps {
  readonly initial: string
  readonly onCommit: (title: string) => void
  readonly onCancel: () => void
}

/** The title typed where a card shows it: its box's accent edge is the focus mark, so no ring. */
export function CardTitleField({
  initial,
  onCommit,
  onCancel
}: CardTitleFieldProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <NameEditor
      initial={initial}
      maxLength={CARD_TITLE_MAX}
      placeholder={t('board.column.newTaskPlaceholder')}
      onCommit={onCommit}
      onCancel={onCancel}
      className="text-ink placeholder:text-ink-faint min-w-0 flex-1 bg-transparent outline-none"
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
  onRename,
  marks,
  drag,
  dropEdge,
  dragging
}: BoardCardTileProps): React.JSX.Element {
  const { t } = useTranslation()
  const [renaming, setRenaming] = useState(false)
  const ended = useRef(false)
  const end = (): void => {
    ended.current = true
    setRenaming(false)
  }
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

  const body = (title: React.JSX.Element): React.JSX.Element => (
    <>
      <span className="flex gap-2">
        <TitleLead priority={priority} />
        {title}
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
    </>
  )

  return (
    <li
      {...(renaming ? {} : drag)}
      data-dragging={dragging ? 'true' : undefined}
      className={`relative ${dragging ? 'opacity-50' : ''}`}
    >
      {dropEdge !== null && <DropLine edge={dropEdge} />}
      {renaming ? (
        <div className={CARD_FIELD_BOX}>
          {body(
            <CardTitleField
              initial={card.title}
              onCommit={(title) => {
                end()
                if (title !== card.title) onRename(title)
              }}
              onCancel={end}
            />
          )}
        </div>
      ) : (
        <button
          type="button"
          // A double-click's second click would open the card again: the panel remounts and
          // a restored description draft takes the focus from the title field.
          onClick={(event) => {
            if (event.detail < 2) onOpen()
          }}
          onDoubleClick={() => {
            if (!card.notText) setRenaming(true)
          }}
          // On the body only: a click away that ended the edit put the focus where it meant to.
          ref={(button) => {
            if (button === null || !ended.current) return
            ended.current = false
            if (document.activeElement === document.body) button.focus()
          }}
          data-card-ref={card.ref}
          aria-keyshortcuts="Enter Alt+ArrowUp Alt+ArrowDown Meta+Backspace"
          aria-current={open ? 'true' : undefined}
          className={`focus-ring hover:border-line-strong ${CARD_BOX} ${open ? 'border-accent/50 bg-canvas' : 'border-line bg-surface'}`}
        >
          {body(<span className="text-ink line-clamp-2 min-w-0 break-words">{card.title}</span>)}
        </button>
      )}
    </li>
  )
}
