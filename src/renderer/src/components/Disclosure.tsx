import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

interface DisclosureChevronProps {
  /** Turns it to point down. */
  readonly open?: boolean
  readonly size?: number
  readonly className?: string
}

/**
 * The mark on everything in the window that folds: pointing right while folded,
 * turned down while open.
 *
 * One icon that turns rather than two that swap. Every fold in the window used
 * to draw its own and they had drifted apart: two pairs of icons, four sizes,
 * and three that never moved.
 */
export function DisclosureChevron({
  open = false,
  size = 12,
  className = ''
}: DisclosureChevronProps): React.JSX.Element {
  const turned = open ? 'rotate-90' : ''

  return (
    <ChevronRight
      aria-hidden
      size={size}
      className={`shrink-0 transition-transform motion-reduce:transition-none ${turned} ${className}`}
    />
  )
}

interface DisclosureButtonProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The surface — padding, hover, type — which is the part each fold owns. */
  readonly className: string
  /** Names the button where its text alone would not, or would say too much. */
  readonly label?: string
  readonly chevron?: Omit<DisclosureChevronProps, 'open'>
  readonly children: ReactNode
}

/**
 * The button that opens and closes a fold: the chevron, then whatever the fold
 * says about itself.
 *
 * Controlled only, and it draws nothing of what it opens. The folds that use it
 * differ exactly there — most unmount what they hide, the build in the right
 * pane only hides it because unmounting would end a running script, a diff's
 * header carries actions beside the button — so the state and the content stay
 * the caller's, and this owns what they share: `aria-expanded`, the toggle and
 * the mark.
 */
export function DisclosureButton({
  open,
  onOpenChange,
  className,
  label,
  chevron = {},
  children
}: DisclosureButtonProps): React.JSX.Element {
  const { className: chevronClass = 'text-ink-faint', ...size } = chevron

  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={label}
      onClick={() => {
        onOpenChange(!open)
      }}
      className={className}
    >
      <DisclosureChevron open={open} className={chevronClass} {...size} />
      {children}
    </button>
  )
}
