import { Check } from 'lucide-react'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'

import { createPortal } from 'react-dom'

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
   * The item is there but cannot be chosen.
   *
   * Shown rather than hidden: a menu whose contents move about is harder to
   * learn than one where an item is visibly unavailable.
   */
  readonly disabled?: boolean
  /**
   * Marks the item as one choice among several, and whether it is the current
   * one. Set it on every item of such a menu, not only the chosen one: it is
   * what turns them from commands into a group with a state, both for the eye
   * and for anything reading the screen.
   */
  readonly selected?: boolean
  /**
   * Starts a group at this item: a line above it, and a heading and a note when
   * given.
   *
   * For a menu that holds commands and a choice side by side — the context
   * menu's `/compact`, its window and `/clear` — where without it the radio
   * rows would read as three more commands.
   */
  readonly section?: MenuSection
  /**
   * A second, icon-only button at the end of the row, for something to do
   * with the item short of choosing it — hearing a sound before picking it.
   * It leaves the menu open, so several can be tried in a row.
   */
  readonly aside?: MenuAside
  /**
   * A second item sharing the row, half the width each: two commands that
   * belong together, like compacting all of a conversation or saying first what
   * to drop. Not combined with `aside` or `selected` — a pair of commands, not a
   * choice.
   */
  readonly beside?: MenuAction
  readonly onSelect: () => void
}

export interface MenuAside {
  /** What a screen reader and the tooltip say; the icon alone says nothing. */
  readonly label: string
  readonly icon: React.ReactNode
  readonly onSelect: () => void
}

export interface MenuSection {
  readonly title?: string
  /** What the group does, or what stands in its way — wrapped, never cut. */
  readonly note?: string
  /** Draws the note as a warning: the group's choices are not what is in force. */
  readonly warning?: boolean
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
  /**
   * The panel's width, for a menu whose own text needs more than the two
   * defaults give. Asked for by the one menu rather than given to all of them,
   * which would leave the short ones full of air.
   */
  readonly width?: number
  /**
   * The tallest the panel may grow before it scrolls, for a menu with more
   * rows than the window is sure to hold.
   */
  readonly maxHeight?: number
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
/** A group's line and heading, and what a note under it may take. */
const SECTION_HEIGHT = 28
const NOTE_HEIGHT = 48

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
  align = 'right',
  width: asked,
  maxHeight
}: DropdownMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{
    top: number
    left: number
    /** Where the panel is drawn, found from the trigger as it is opened. */
    host: Element
  } | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  const described = actions.some((action) => action.description !== undefined)
  const width = asked ?? (described ? DESCRIBED_WIDTH : PANEL_WIDTH)

  const close = useCallback(() => {
    setOpen(false)
  }, [])

  useDismiss(open, container, close, panel)

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
    const rows = actions.reduce(
      (total, action) =>
        total +
        ROW_HEIGHT +
        (action.description === undefined ? 0 : DESCRIPTION_HEIGHT) +
        (action.section === undefined ? 0 : SECTION_HEIGHT) +
        (action.section?.note === undefined ? 0 : NOTE_HEIGHT),
      8
    )
    const height = maxHeight === undefined ? rows : Math.min(rows, maxHeight)

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
      ),
      host: element.closest('dialog') ?? document.body
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

      {open &&
        position &&
        /*
         * Into the body, not beside the trigger.
         *
         * `z-50` only ever means "above its own siblings". A `sticky` element
         * with a `z-index` starts a stacking context of its own, and the diff's
         * file headers are exactly that — so this menu, opened from one of
         * them, was painted inside that header's context and the **next**
         * header covered it. Nothing about the number would have fixed it.
         *
         * The coordinates are already the window's, so nothing about the
         * placement changes; what changes is which box the painting is
         * confined to.
         *
         * Into the `<dialog>` instead, when the trigger sits in one.
         * `showModal()` lifts it into the top layer above the whole body and
         * makes the body inert, so the sound picker in Settings opened behind
         * the dialog where nothing could reach it. `fixed` still means the
         * window there only while the dialog carries no transform, filter or
         * `contain` — give it an open animation and this panel moves with it.
         */
        createPortal(
          <div
            ref={panel}
            role="menu"
            style={{ top: position.top, left: position.left, width, maxHeight }}
            className="overflow-y-auto border-line bg-canvas fixed z-50 rounded-[var(--radius-panel)] border p-1 shadow-[var(--shadow-pop)]"
          >
            {actions.map((action) => (
              <Fragment key={action.id}>
                {action.section !== undefined && <SectionHead section={action.section} />}
                {action.beside !== undefined ? (
                  // Two items, each its own button: the row is a pair of
                  // commands, and either is chosen without the other.
                  <div className="grid grid-cols-2 gap-1">
                    <MenuItem action={action} onChosen={close} />
                    <MenuItem action={action.beside} onChosen={close} />
                  </div>
                ) : action.aside === undefined ? (
                  <MenuItem action={action} onChosen={close} />
                ) : (
                  // Two buttons side by side rather than one inside the other:
                  // a button in a button is invalid HTML, and its click would
                  // choose the item as well.
                  <div className="flex items-center">
                    <MenuItem action={action} onChosen={close} />
                    <AsideButton aside={action.aside} />
                  </div>
                )}
              </Fragment>
            ))}
          </div>,
          position.host
        )}
    </div>
  )
}

function MenuItem({
  action,
  onChosen
}: {
  readonly action: MenuAction
  readonly onChosen: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      // A choice among several is a radio group, not a list of commands.
      // The role is what carries that to a screen reader, and it is also
      // the only part of this a jsdom test can see.
      {...(action.selected === undefined
        ? { role: 'menuitem' }
        : { role: 'menuitemradio', 'aria-checked': action.selected })}
      disabled={action.disabled ?? false}
      onClick={() => {
        onChosen()
        action.onSelect()
      }}
      className={`row focus-ring flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left disabled:pointer-events-none disabled:opacity-40 ${
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
          <Check aria-hidden size={12} className={action.selected ? 'text-accent' : 'opacity-0'} />
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
  )
}

function AsideButton({ aside }: { readonly aside: MenuAside }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={aside.label}
      title={aside.label}
      onClick={aside.onSelect}
      className="row focus-ring text-ink-faint hover:text-ink flex size-7 shrink-0 items-center justify-center"
    >
      {aside.icon}
    </button>
  )
}

/**
 * Where a group starts: a line, its name, and what it needs saying.
 *
 * Presentation only — the rows under it are what a screen reader walks, and a
 * menu item that cannot be chosen would be one more stop for nothing. The note
 * still reaches it: a choice blocked by a variable set elsewhere is said by
 * the rows' own descriptions too.
 */
function SectionHead({ section }: { readonly section: MenuSection }): React.JSX.Element {
  return (
    <div role="presentation" className="border-line mt-1 border-t px-2.5 pt-2 pb-1">
      {section.title !== undefined && <p className="section-label">{section.title}</p>}
      {section.note !== undefined && (
        <p
          className={`mt-0.5 text-[11px] leading-4 ${section.warning === true ? 'text-warning' : 'text-ink-faint'}`}
        >
          {section.note}
        </p>
      )}
    </div>
  )
}
