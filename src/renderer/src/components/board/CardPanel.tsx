import { ChevronDown, Copy, Ellipsis, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  BOARD_STATUSES,
  type BoardCard,
  type BoardStatus,
  type CardDetail,
  type CardMove,
  CARD_PRIORITIES,
  type CardPriority,
  CARD_TITLE_MAX
} from '@core/boardSchema.js'
import { KIND_COLORS, WORKSPACE_KINDS, type WorkspaceKind } from '@core/workspaceKinds.js'

import type { Failure } from '../../../../preload/index.js'
import type { BoardController } from '../../hooks/useBoard.js'
import { useCopy } from '../../hooks/useCopy.js'
import { useErrorMessage } from '../../hooks/useErrorMessage.js'
import { Button } from '../Button.js'
import { DropdownMenu, type MenuAction } from '../DropdownMenu.js'
import { NameEditor } from '../NameEditor.js'
import { IconButton } from '../paneControls.js'
import { Callout } from '../pr/Callout.js'
import { LETTERS } from '../projectTint.js'
import { ResizeHandle } from '../ResizeHandle.js'
import type { DescriptionDraft } from './boardDrafts.js'
import { NO_PRIORITY_LOOK, PRIORITY_LOOKS, STATUS_LABEL_KEYS } from './boardLabels.js'
import { CardComments } from './CardComments.js'
import { CardDescription } from './CardDescription.js'

export const PANEL_WIDTH = 420
export const PANEL_MIN = 320
export const PANEL_MAX = 720

const PRIORITY_CHOICES: readonly (CardPriority | null)[] = [...CARD_PRIORITIES, null]
const TAG_CHOICES: readonly (WorkspaceKind | null)[] = [...WORKSPACE_KINDS, null]

export interface CardPanelProps {
  /** From the listing: the header draws at once, before the detail arrives. */
  readonly card: BoardCard
  readonly detail: CardDetail | null
  readonly failure: Failure | null
  readonly board: BoardController
  readonly draft: DescriptionDraft | null
  readonly onDraft: (draft: DescriptionDraft | null) => void
  readonly width: number
  readonly onWidth: (width: number) => void
  readonly onClose: () => void
  /** A status change; the screen moves the card and follows its new ref. */
  readonly onMove: (move: CardMove) => void
  /** Asks to delete; the screen confirms, because ⌘⌫ (B205) deletes with no panel open. */
  readonly onRemove: () => void
}

function choices<V extends string | null>(
  values: readonly V[],
  current: V,
  label: (value: V) => string,
  choose: (value: V) => void
): MenuAction[] {
  return values.map((value) => ({
    id: value ?? 'none',
    label: label(value),
    selected: value === current,
    onSelect: () => {
      if (value !== current) choose(value)
    }
  }))
}

function MenuTrigger({
  title,
  open,
  onClick,
  children
}: {
  readonly title: string
  readonly open: boolean
  readonly onClick: (event: React.MouseEvent) => void
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="menu"
      aria-expanded={open}
      title={title}
      className="focus-ring hover:bg-muted text-ink flex h-6 min-w-0 items-center gap-1 rounded-[var(--radius-control)] px-1.5 text-[12px] transition-colors"
    >
      {children}
      <ChevronDown aria-hidden size={12} className="text-ink-faint shrink-0" />
    </button>
  )
}

function CopyDescription({
  description
}: {
  readonly description: string | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const clipboard = useCopy()
  const label =
    clipboard.state === 'done'
      ? t('board.panel.copied')
      : clipboard.state === 'failed'
        ? t('chat.copyFailed')
        : t('board.panel.copy')

  return (
    <Button
      size="sm"
      disabled={description === null}
      onClick={description === null ? undefined : () => void clipboard.copy(description.trim())}
    >
      <Copy aria-hidden size={12} />
      {label}
    </Button>
  )
}

export function CardPanel({
  card,
  detail,
  failure,
  board,
  draft,
  onDraft,
  width,
  onWidth,
  onClose,
  onMove,
  onRemove
}: CardPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const [renaming, setRenaming] = useState(false)
  const describeFailure = useErrorMessage()
  const statusLabel = (status: BoardStatus): string =>
    t(`board.statuses.${STATUS_LABEL_KEYS[status]}`)
  const priorityLabel = (value: CardPriority | null): string =>
    value === null ? t('board.priorities.none') : t(`board.priorities.${value}`)
  const tagLabel = (value: WorkspaceKind | null): string =>
    value === null ? t('board.panel.noTag') : t(`workspaces.kinds.${value}.label`)
  const priority = card.meta.priority ?? null
  const tag = card.meta.tag ?? null
  const { icon: PriorityIcon, tone } =
    priority === null ? NO_PRIORITY_LOOK : PRIORITY_LOOKS[priority]

  return (
    <aside
      aria-label={card.title}
      style={{ width }}
      className="border-line bg-surface relative flex min-h-0 shrink-0 flex-col border-l"
    >
      <ResizeHandle
        grows="left"
        width={width}
        min={PANEL_MIN}
        max={PANEL_MAX}
        onResize={onWidth}
        onCommit={onWidth}
      />
      <header className="border-line flex h-10 shrink-0 items-center gap-1 border-b px-2">
        <DropdownMenu
          align="left"
          actions={choices(BOARD_STATUSES, card.status, statusLabel, (status) => {
            onMove({ status, index: 0 })
          })}
          trigger={({ onClick, open }) => (
            <MenuTrigger title={t('board.panel.status')} open={open} onClick={onClick}>
              <span className="truncate">{statusLabel(card.status)}</span>
            </MenuTrigger>
          )}
        />
        <DropdownMenu
          align="left"
          actions={choices(PRIORITY_CHOICES, priority, priorityLabel, (value) => {
            void board.update(card.ref, { priority: value })
          })}
          trigger={({ onClick, open }) => (
            <MenuTrigger title={t('board.panel.priority')} open={open} onClick={onClick}>
              <PriorityIcon aria-hidden size={12} className={`shrink-0 ${tone}`} />
              <span className="truncate">{priorityLabel(priority)}</span>
            </MenuTrigger>
          )}
        />
        <DropdownMenu
          align="left"
          maxHeight={320}
          actions={choices(TAG_CHOICES, tag, tagLabel, (value) => {
            void board.update(card.ref, { tag: value })
          })}
          trigger={({ onClick, open }) => (
            <MenuTrigger title={t('board.panel.tag')} open={open} onClick={onClick}>
              {tag === null ? (
                <span className="truncate">{tagLabel(null)}</span>
              ) : (
                <span
                  className="truncate font-medium"
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
            </MenuTrigger>
          )}
        />
        <span className="ml-auto" />
        <DropdownMenu
          align="right"
          actions={[
            {
              id: 'remove',
              label: t('board.panel.remove'),
              icon: <Trash2 aria-hidden size={13} />,
              destructive: true,
              onSelect: onRemove
            }
          ]}
          trigger={({ onClick, open }) => (
            <button
              type="button"
              onClick={onClick}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label={t('board.panel.more')}
              title={t('board.panel.more')}
              className="focus-ring text-ink-faint hover:text-ink hover:bg-muted shrink-0 rounded-[var(--radius-control)] p-1"
            >
              <Ellipsis aria-hidden size={14} />
            </button>
          )}
        />
        <IconButton label={t('board.panel.close')} onClick={onClose}>
          <X aria-hidden size={14} />
        </IconButton>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
        {renaming ? (
          <NameEditor
            initial={card.title}
            maxLength={CARD_TITLE_MAX}
            className="input focus-ring text-[15px] font-semibold"
            onCommit={(title) => {
              setRenaming(false)
              if (title !== card.title) void board.rename(card.ref, title)
            }}
            onCancel={() => {
              setRenaming(false)
            }}
          />
        ) : (
          <h2
            onDoubleClick={() => {
              setRenaming(true)
            }}
            className="text-ink cursor-text text-[15px] font-semibold break-words"
          >
            {card.title}
          </h2>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <CopyDescription description={card.notText ? null : (detail?.description ?? null)} />
        </div>
        {failure !== null && <Callout tone="warning">{describeFailure(failure)}</Callout>}
        {detail !== null && (
          <>
            {card.notText ? (
              <Callout tone="warning">{t('board.card.notText')}</Callout>
            ) : (
              <CardDescription
                description={detail.description}
                draft={draft}
                onDraft={onDraft}
                onSave={(save) => board.saveDescription(card.ref, save)}
              />
            )}
            <CardComments thread={detail.thread} onAdd={(text) => board.comment(card.ref, text)} />
          </>
        )}
      </div>
    </aside>
  )
}
