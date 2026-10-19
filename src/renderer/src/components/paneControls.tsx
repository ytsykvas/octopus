/**
 * The two small pieces every right-pane tab draws: a message in place of
 * content, and a quiet icon button for its toolbar. Shared once the Files tab
 * needed both as well; the pull request tab still keeps a copy of `Notice` of
 * its own.
 */

export function Notice({
  children,
  tone = 'soft'
}: {
  readonly children: React.ReactNode
  readonly tone?: 'soft' | 'danger'
}): React.JSX.Element {
  return (
    <div className="flex-1 overflow-auto p-4">
      <p className={`leading-relaxed ${tone === 'danger' ? 'text-danger' : 'text-ink-faint'}`}>
        {children}
      </p>
    </div>
  )
}

export function IconButton({
  label,
  onClick,
  disabled = false,
  children
}: {
  readonly label: string
  /** May be absent while the button is disabled, when nothing can call it. */
  readonly onClick?: (() => void) | undefined
  readonly disabled?: boolean
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="focus-ring text-ink-faint hover:text-ink hover:bg-muted rounded-[var(--radius-control)] p-1 disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  )
}
