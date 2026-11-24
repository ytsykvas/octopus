import { ListFilter, Search } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { CARD_PRIORITIES } from '@core/boardSchema.js'
import { withMember } from '@core/lists.js'
import { present } from '@core/present.js'
import { WORKSPACE_KINDS } from '@core/workspaceKinds.js'

import { useWindowEvent } from '../../hooks/useWindowEvent.js'
import { Button } from '../Button.js'
import { DropdownMenu } from '../DropdownMenu.js'
import {
  type BoardFilter,
  EMPTY_BOARD_FILTER,
  isFilterActive,
  type PriorityFilter,
  type TagFilter
} from './boardFilter.js'
import { focusedCard } from './boardKeys.js'

const PRIORITY_FILTERS: readonly PriorityFilter[] = [...CARD_PRIORITIES, 'none']
const TAG_FILTERS: readonly TagFilter[] = [...WORKSPACE_KINDS, 'none']
// Thirteen tags do not fit every window; the priority menu never reaches it.
const MENU_MAX_HEIGHT = 320

export interface BoardFilterBarProps {
  readonly filter: BoardFilter
  readonly onChange: (filter: BoardFilter) => void
}

export function BoardFilterBar({ filter, onChange }: BoardFilterBarProps): React.JSX.Element {
  const { t } = useTranslation()
  const field = useRef<HTMLInputElement>(null)

  useWindowEvent('keydown', (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
    if (document.querySelector('dialog[open]') !== null) return
    if (document.querySelector('[role="menu"], [role="dialog"]') !== null) return
    // On a field or a button the slash is that control's, the search's own included.
    if (focusedCard(event.target) === undefined) return
    event.preventDefault()
    present(field.current, 'the mounted search field').focus()
  })

  return (
    <div className="ml-auto flex items-center gap-1">
      <label className="relative flex items-center">
        <Search
          aria-hidden
          size={13}
          className="text-ink-faint pointer-events-none absolute left-2"
        />
        <input
          ref={field}
          type="search"
          value={filter.query}
          aria-label={t('board.filter.search')}
          placeholder={t('board.filter.search')}
          onChange={(event) => {
            onChange({ ...filter, query: event.target.value })
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            onChange({ ...filter, query: '' })
            event.currentTarget.blur()
          }}
          className="input focus-ring h-6 w-[220px] pl-7 text-[12px]"
        />
      </label>
      <FilterMenu
        label={t('board.filter.priority')}
        options={PRIORITY_FILTERS}
        chosen={filter.priorities}
        labelOf={(id) => t(`board.priorities.${id}`)}
        onChange={(priorities) => {
          onChange({ ...filter, priorities })
        }}
      />
      <FilterMenu
        label={t('board.filter.tag')}
        options={TAG_FILTERS}
        chosen={filter.tags}
        labelOf={(id) =>
          id === 'none' ? t('board.panel.noTag') : t(`workspaces.kinds.${id}.label`)
        }
        onChange={(tags) => {
          onChange({ ...filter, tags })
        }}
      />
      {isFilterActive(filter) && (
        <Button
          variant="quiet"
          size="sm"
          onClick={() => {
            onChange(EMPTY_BOARD_FILTER)
          }}
        >
          {t('board.filter.clear')}
        </Button>
      )}
    </div>
  )
}

function FilterMenu<T extends string>({
  label,
  options,
  chosen,
  labelOf,
  onChange
}: {
  readonly label: string
  readonly options: readonly T[]
  readonly chosen: readonly T[]
  readonly labelOf: (option: T) => string
  readonly onChange: (chosen: T[]) => void
}): React.JSX.Element {
  const active = chosen.length > 0
  return (
    <DropdownMenu
      align="right"
      maxHeight={MENU_MAX_HEIGHT}
      actions={options.map((id) => ({
        id,
        label: labelOf(id),
        selected: chosen.includes(id),
        onSelect: () => {
          onChange(withMember(chosen, id, !chosen.includes(id)))
        }
      }))}
      trigger={({ onClick, open }) => (
        <button
          type="button"
          onClick={onClick}
          aria-haspopup="menu"
          aria-expanded={open}
          data-active={active}
          className={`focus-ring hover:bg-muted flex h-6 items-center gap-1 rounded-[var(--radius-control)] px-1.5 text-[12px] transition-colors ${active ? 'text-accent' : 'text-ink-soft'}`}
        >
          <ListFilter aria-hidden size={13} />
          {label}
        </button>
      )}
    />
  )
}
