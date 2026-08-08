import { useCallback, useEffect, useRef, useState } from 'react'

import { useDismiss } from '../hooks/useDismiss.js'

export interface MenuAction {
  readonly id: string
  readonly label: string
  /** A second line explaining what the item does. */
  readonly description?: string
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
  /** Which edge of the trigger the panel lines up with. */
  readonly align?: 'left' | 'right'
}

const PANEL_WIDTH = 232
/** Gap between trigger and panel, and the smallest margin to a window edge. */
const GAP = 6

/**
 * A popup menu.
 *
 * Positioned against the window rather than its trigger. The obvious
 * `absolute` panel is clipped by any scrolling ancestor, and the project tab
 * strip is exactly that — the menu came out sliced to the width of a 56px
 * column. Fixed coordinates cost a measurement and dismissal on scroll, and
 * buy a menu that is the size it says it is wherever it is opened from.
 */
export function DropdownMenu({
  trigger,
  actions,
  align = 'right'
}: DropdownMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const container = useRef<HTMLDivElement>(null)

  const close = useCallback(() => {
    setOpen(false)
  }, [])

  useDismiss(open, container, close)

  // Fixed coordinates are a snapshot: anything that moves the trigger leaves
  // the panel floating where the trigger used to be, so it closes instead.
  useEffect(() => {
    if (!open) return

    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)

    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open, close])

  const openAt = (element: HTMLElement): void => {
    const rect = element.getBoundingClientRect()
    const height = actions.length * 40 + 8

    setPosition({
      // Flips above the trigger when there is no room below — near the bottom
      // of a tab strip that is most of the time.
      top:
        rect.bottom + GAP + height > window.innerHeight
          ? Math.max(GAP, rect.top - height - GAP)
          : rect.bottom + GAP,
      left: Math.min(
        Math.max(GAP, align === 'right' ? rect.right - PANEL_WIDTH : rect.left),
        window.innerWidth - PANEL_WIDTH - GAP
      )
    })

    setOpen(true)
  }

  return (
    <div ref={container} className="contents">
      {trigger({
        open,
        onClick: (event) => {
          event.stopPropagation()

          if (open) {
            setOpen(false)
            return
          }

          openAt(event.currentTarget as HTMLElement)
        }
      })}

      {open && position && (
        <div
          role="menu"
          style={{ top: position.top, left: position.left, width: PANEL_WIDTH }}
          className="border-line bg-canvas fixed z-50 rounded-[var(--radius-panel)] border p-1 shadow-[var(--shadow-pop)]"
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
              className={`row focus-ring flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left ${
                action.destructive === true
                  ? 'text-danger hover:bg-danger-bg'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {action.icon}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate">{action.label}</span>
                {action.description !== undefined && (
                  <span className="text-ink-faint block truncate text-[11px]">
                    {action.description}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
