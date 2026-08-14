import { Check } from 'lucide-react'
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
  /**
   * Marks the item as one choice among several, and whether it is the current
   * one. Set it on every item of such a menu, not only the chosen one: it is
   * what turns them from commands into a group with a state, both for the eye
   * and for anything reading the screen.
   */
  readonly selected?: boolean
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
/**
 * What a menu whose items carry a second line gets instead.
 *
 * The descriptions come from outside — the agent writes the ones on the models,
 * and "Fable 5 · Most capable for your hardest and longest-running tasks" does
 * not fit a width chosen for one-word commands. Widening every menu to suit
 * them would leave the short ones full of air, so the menu asks its own items.
 */
const DESCRIBED_WIDTH = 288

/** Gap between trigger and panel, and the smallest margin to a window edge. */
const GAP = 6

/** One row, and what a second line adds to it — two lines of it at most. */
const ROW_HEIGHT = 32
const DESCRIPTION_HEIGHT = 32

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

  const described = actions.some((action) => action.description !== undefined)
  const width = described ? DESCRIBED_WIDTH : PANEL_WIDTH

  const close = useCallback(() => {
    setOpen(false)
  }, [])

  useDismiss(open, container, close)

  // Fixed coordinates are a snapshot: anything that moves the trigger leaves
  // the panel floating where the trigger used to be, so it closes instead.
  useEffect(() => {
    if (!open) return

    /*
     * Only a scroll that could move the trigger counts, which means one in an
     * element the trigger sits inside. Scrolling anything else cannot shift it
     * a pixel — scrolling does not reflow the rest of the page.
     *
     * Closing on every scroll instead was the rule for a while, and the chat
     * log is what broke it: it pins itself to the bottom on each streamed
     * fragment, so the composer's menus shut a few times a second for as long
     * as the agent was answering, while the composer itself never moved. The
     * listener has to be on the window in the capture phase because a scroll
     * event does not bubble, so `target` is the only thing saying where it
     * happened.
     */
    const closeOnScroll = (event: Event): void => {
      const scrolled = event.target
      if (scrolled instanceof Node && !scrolled.contains(container.current)) return

      close()
    }

    window.addEventListener('scroll', closeOnScroll, true)
    window.addEventListener('resize', close)

    return () => {
      window.removeEventListener('scroll', closeOnScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open, close])

  const openAt = (element: HTMLElement): void => {
    const rect = element.getBoundingClientRect()

    // Counted per row rather than as one figure per item, because a second line
    // is worth two rows of its own. Erring high is the safe way to be wrong: it
    // flips the menu above the trigger sooner than it must, where erring low
    // would run it off the bottom of the window.
    const height = actions.reduce(
      (total, action) =>
        total + ROW_HEIGHT + (action.description === undefined ? 0 : DESCRIPTION_HEIGHT),
      8
    )

    setPosition({
      // Flips above the trigger when there is no room below — near the bottom
      // of a tab strip that is most of the time.
      top:
        rect.bottom + GAP + height > window.innerHeight
          ? Math.max(GAP, rect.top - height - GAP)
          : rect.bottom + GAP,
      left: Math.min(
        Math.max(GAP, align === 'right' ? rect.right - width : rect.left),
        window.innerWidth - width - GAP
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
          style={{ top: position.top, left: position.left, width }}
          className="border-line bg-canvas fixed z-50 rounded-[var(--radius-panel)] border p-1 shadow-[var(--shadow-pop)]"
        >
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              // A choice among several is a radio group, not a list of commands.
              // The role is what carries that to a screen reader, and it is also
              // the only part of this a jsdom test can see.
              {...(action.selected === undefined
                ? { role: 'menuitem' }
                : { role: 'menuitemradio', 'aria-checked': action.selected })}
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
                {/* The tick keeps its space when it is not the current choice,
                    so the labels of a picker line up instead of stepping left
                    and right as the selection moves. */}
                {action.selected === undefined ? (
                  action.icon
                ) : (
                  <Check
                    aria-hidden
                    size={12}
                    className={action.selected ? 'text-accent' : 'opacity-0'}
                  />
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate">{action.label}</span>
                {/* Wrapped rather than truncated, unlike the label above it.
                    A name cut short is still a name; a sentence cut short at
                    "Most capable for your …" is the half that says nothing.
                    Two lines is the cap — past that the menu is a document. */}
                {action.description !== undefined && (
                  <span className="text-ink-faint line-clamp-2 text-[11px] leading-4">
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
