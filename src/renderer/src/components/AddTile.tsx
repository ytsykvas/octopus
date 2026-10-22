import { LoaderCircle, Plus } from 'lucide-react'

interface AddTileProps {
  readonly title: string
  readonly disabled: boolean
  readonly onClick: (event: React.MouseEvent) => void
  /** The thing being added is on its way; the plus gives way to a turning mark. */
  readonly busy?: boolean
  readonly className?: string
}

/**
 * A "+" drawn as an empty slot: a dashed tile the size of a project tab.
 *
 * One component for every place something is added to a list — the strip's
 * repositories and the sidebar's workspaces — so the two read as the same
 * gesture and cannot drift apart one class at a time.
 */
export function AddTile({
  title,
  disabled,
  onClick,
  busy = false,
  className = ''
}: AddTileProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`text-ink-faint hover:border-ink-faint hover:text-ink focus-ring border-line-strong flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-dashed transition-colors disabled:cursor-default disabled:opacity-50 ${className}`}
    >
      {/* A turning mark rather than a dimmed plus: adding can take a while,
          and a still icon on a button that stopped responding reads as the app
          having hung rather than as it working. */}
      {busy ? (
        <LoaderCircle aria-hidden className="animate-spin" size={16} />
      ) : (
        <Plus aria-hidden size={16} />
      )}
    </button>
  )
}
