import { ChevronDown } from 'lucide-react'

interface ComposerChipProps {
  /** Names the control for anything reading the screen; the row shows no labels. */
  readonly label: string
  /** What the chip says — the choice in force, in as many words as fit. */
  readonly value: string
  /** Typed to the button it is on, so `currentTarget` is something to measure. */
  readonly onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  /** Whether what it opens is open, which is what tints it while it is. */
  readonly open: boolean
  /** `menu` for a list of choices, `dialog` for a panel holding more than one. */
  readonly popup: 'menu' | 'dialog'
  readonly icon?: React.ReactNode
  readonly disabled?: boolean
  /** Why it is disabled, or what the current choice means. */
  readonly title?: string
}

/**
 * One setting in the composer's control row, as a button that opens something.
 *
 * Ghost rather than `Button`: a bordered control on the composer's own surface
 * reads as a filled chip, and three of them turn the row into a toolbar
 * competing with the field above it. These sit quiet until pointed at.
 *
 * Its own file because two things now open from this row and they are not the
 * same kind of thing — the effort picker opens a menu, the model chip opens a
 * two-column panel. Written twice, the classes would drift apart the first time
 * either was touched, and the row's whole argument is that they look alike.
 */
export function ComposerChip({
  label,
  value,
  onClick,
  open,
  popup,
  icon,
  disabled = false,
  title
}: ComposerChipProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-haspopup={popup}
      aria-expanded={open}
      {...(title !== undefined && { title })}
      // `min-w-0` rather than `shrink-0`: with the latter the label's
      // `truncate` could never fire, since something that cannot shrink has
      // nothing to shorten — and the row it sits in ran off the edge instead.
      // The icon and the chevron keep their own `shrink-0`, so what gives way
      // is the wording.
      className={`focus-ring hover:bg-muted hover:text-ink inline-flex h-6 min-w-0 items-center gap-1 rounded-[var(--radius-control)] px-1.5 text-[11px] transition-colors disabled:pointer-events-none disabled:opacity-50 ${
        open ? 'bg-muted text-ink' : 'text-ink-soft'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{value}</span>
      <ChevronDown aria-hidden size={11} className="shrink-0 opacity-60" />
    </button>
  )
}
