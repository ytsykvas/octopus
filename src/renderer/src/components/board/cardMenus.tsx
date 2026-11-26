import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { Column } from '@core/boardColumns.js'
import { CARD_PRIORITIES, type CardPriority, type ColumnId } from '@core/boardSchema.js'
import { KIND_COLORS, WORKSPACE_KINDS, type WorkspaceKind } from '@core/workspaceKinds.js'

import { DropdownMenu, type MenuAction } from '../DropdownMenu.js'
import { LETTERS, projectColorStyle } from '../projectTint.js'
import { columnLabel, NO_PRIORITY_LOOK, PRIORITY_LOOKS } from './boardLabels.js'

const PRIORITY_CHOICES: readonly (CardPriority | null)[] = [...CARD_PRIORITIES, null]
const TAG_CHOICES: readonly (WorkspaceKind | null)[] = [...WORKSPACE_KINDS, null]

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

/** A column a proposal names may be removed meanwhile: it reads as its id rather than failing. */
export function StatusMenu({
  columns,
  status,
  onChoose
}: {
  readonly columns: readonly Column[]
  readonly status: ColumnId
  readonly onChoose: (status: ColumnId) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const label = (id: ColumnId): string => {
    const column = columns.find((candidate) => candidate.id === id)
    return column === undefined ? id : columnLabel(column, t)
  }
  return (
    <DropdownMenu
      align="left"
      actions={choices(
        columns.map((column) => column.id),
        status,
        label,
        onChoose
      )}
      trigger={({ onClick, open }) => (
        <MenuTrigger title={t('board.panel.status')} open={open} onClick={onClick}>
          <span className="truncate">{label(status)}</span>
        </MenuTrigger>
      )}
    />
  )
}

export function PriorityMenu({
  priority,
  onChoose
}: {
  readonly priority: CardPriority | null
  readonly onChoose: (priority: CardPriority | null) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const label = (value: CardPriority | null): string =>
    value === null ? t('board.priorities.none') : t(`board.priorities.${value}`)
  const { icon: PriorityIcon, tone } =
    priority === null ? NO_PRIORITY_LOOK : PRIORITY_LOOKS[priority]
  return (
    <DropdownMenu
      align="left"
      actions={choices(PRIORITY_CHOICES, priority, label, onChoose)}
      trigger={({ onClick, open }) => (
        <MenuTrigger title={t('board.panel.priority')} open={open} onClick={onClick}>
          <PriorityIcon aria-hidden size={12} className={`shrink-0 ${tone}`} />
          <span className="truncate">{label(priority)}</span>
        </MenuTrigger>
      )}
    />
  )
}

export function TagMenu({
  tag,
  onChoose
}: {
  readonly tag: WorkspaceKind | null
  readonly onChoose: (tag: WorkspaceKind | null) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const label = (value: WorkspaceKind | null): string =>
    value === null ? t('board.panel.noTag') : t(`workspaces.kinds.${value}.label`)
  return (
    <DropdownMenu
      align="left"
      maxHeight={320}
      actions={choices(TAG_CHOICES, tag, label, onChoose)}
      trigger={({ onClick, open }) => (
        <MenuTrigger title={t('board.panel.tag')} open={open} onClick={onClick}>
          {tag === null ? (
            <span className="truncate">{label(null)}</span>
          ) : (
            <span
              className="truncate font-medium"
              style={{ ...projectColorStyle(KIND_COLORS[tag]), color: LETTERS }}
            >
              {t(`workspaces.kinds.${tag}.short`)}
            </span>
          )}
        </MenuTrigger>
      )}
    />
  )
}
