import { useEffect, useRef, useState } from 'react'

export interface MenuAction {
  readonly id: string
  readonly label: string
  readonly icon?: React.ReactNode
  /** Renders the item in the danger colour — for actions that destroy something. */
  readonly destructive?: boolean
  readonly onSelect: () => void
}

interface DropdownMenuProps {
  /** The control that opens the menu; it receives the click handler. */
  readonly trigger: (props: {
    onClick: (event: React.MouseEvent) => void
    open: boolean
  }) => React.ReactNode
  readonly actions: readonly MenuAction[]
  /** Aligns the panel; `right` keeps it inside a narrow sidebar. */
  readonly align?: 'left' | 'right'
}

/**
 * A small popup menu.
 *
 * Shared rather than repeated: the dismiss-on-outside-click and
 * dismiss-on-Escape behaviour is easy to write slightly differently each time,
 * and a menu that ignores Escape feels broken.
 */
export function DropdownMenu({
  trigger,
  actions,
  align = 'right'
}: DropdownMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent): void => {
      // A click inside the menu is handled by the item itself.
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={container} className="relative">
      {trigger({
        open,
        onClick: (event) => {
          event.stopPropagation()
          setOpen((current) => !current)
        }
      })}

      {open && (
        <div
          role="menu"
          className={`border-line bg-canvas absolute z-20 mt-1 w-44 rounded-[var(--radius-control)] border p-1 shadow-[var(--shadow-pop)] ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                action.onSelect()
              }}
              className={`row focus-ring flex w-full items-center gap-2 px-2 py-1 text-left ${
                action.destructive === true
                  ? 'text-danger hover:bg-danger-bg'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
