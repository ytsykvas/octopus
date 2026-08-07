import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useDismiss } from '../hooks/useDismiss.js'

interface ComboboxProps {
  readonly value: string
  readonly options: readonly string[]
  readonly onChange: (value: string) => void
  readonly placeholder?: string
  /** Shown in the list when nothing matches the query. */
  readonly emptyLabel?: string
  readonly disabled?: boolean
}

/**
 * A select with a search box.
 *
 * A native `<select>` stops being usable somewhere around thirty entries, and
 * a repository's branch list passes that easily. Typing to filter is the only
 * way to reach the one you want without scrolling by eye.
 */
export function Combobox({
  value,
  options,
  onChange,
  placeholder,
  emptyLabel,
  disabled = false
}: ComboboxProps): React.JSX.Element {
  const { t } = useTranslation()
  const container = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])

  useDismiss(open, container, close)

  const matches = options.filter((option) =>
    option.toLowerCase().includes(query.trim().toLowerCase())
  )

  // Opening lands the caret in the search box: the reason to open this rather
  // than a plain select is to type.
  useEffect(() => {
    if (open) search.current?.focus()
  }, [open])

  // Keyboard navigation is useless if the highlighted row is off screen.
  useEffect(() => {
    if (!open) return
    list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const choose = (option: string): void => {
    onChange(option)
    close()
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      // Wraps, so holding one direction always reaches every entry.
      setActive((current) => (current + step + matches.length) % Math.max(matches.length, 1))
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      const option = matches[active]
      if (option !== undefined) choose(option)
    }
  }

  return (
    <div ref={container} className="relative w-full max-w-sm">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen((current) => !current)
        }}
        className="input focus-ring hover:bg-muted flex items-center gap-2 text-left transition-colors disabled:pointer-events-none disabled:opacity-50"
      >
        <span className="min-w-0 flex-1 truncate font-mono">{value}</span>
        <ChevronsUpDown aria-hidden size={12} className="text-ink-faint shrink-0" />
      </button>

      {open && (
        <div className="border-line bg-canvas absolute z-30 mt-1 w-full overflow-hidden rounded-[var(--radius-control)] border shadow-[var(--shadow-pop)]">
          <div className="border-line flex items-center gap-2 border-b px-2">
            <Search aria-hidden size={12} className="text-ink-faint shrink-0" />
            <input
              ref={search}
              value={query}
              spellCheck={false}
              placeholder={placeholder ?? t('combobox.search')}
              onChange={(event) => {
                setQuery(event.target.value)
                // Filtering shifts what sits at each index, so the highlight
                // returns to the top instead of pointing at a row that only
                // happens to still be there.
                setActive(0)
              }}
              onKeyDown={onKeyDown}
              className="h-7 w-full bg-transparent outline-none"
            />
          </div>

          <div ref={list} className="max-h-56 overflow-auto p-1">
            {matches.length === 0 ? (
              <p className="text-ink-faint px-2 py-1.5">{emptyLabel ?? t('combobox.empty')}</p>
            ) : (
              matches.map((option, index) => (
                <button
                  key={option}
                  type="button"
                  // Hovering moves the highlight so the mouse and the keyboard
                  // never disagree about which row Enter would take.
                  onMouseEnter={() => {
                    setActive(index)
                  }}
                  onClick={() => {
                    choose(option)
                  }}
                  className={`flex w-full items-center gap-2 rounded-[4px] px-2 py-1 text-left ${
                    index === active ? 'bg-muted text-ink' : 'text-ink-soft'
                  }`}
                >
                  <Check
                    aria-hidden
                    size={12}
                    className={`shrink-0 ${option === value ? 'text-accent' : 'opacity-0'}`}
                  />
                  <span className="truncate font-mono">{option}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
