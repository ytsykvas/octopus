/**
 * The two small pieces every right-pane tab draws: a message in place of
 * content, and a quiet icon button for its toolbar. Shared once the Files tab
 * needed both as well; the pull request tab still keeps a copy of `Notice` of
 * its own. The chat log floats the same button over its content.
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
  pressed,
  floating = false,
  children
}: {
  readonly label: string
  /** May be absent while the button is disabled, when nothing can call it. */
  readonly onClick?: (() => void) | undefined
  readonly disabled?: boolean
  /** Set only on a toggle; a plain action has no pressed state to announce. */
  readonly pressed?: boolean
  /** Bordered, over moving content, clickable through a pass-through row. */
  readonly floating?: boolean
  readonly children: React.ReactNode
}): React.JSX.Element {
  // A floating button can disable under the reader's own keypress — a step that
  // reaches the end — and a natively disabled button drops the focus it holds.
  const softDisabled = floating && disabled

  return (
    <button
      type="button"
      onClick={softDisabled ? undefined : onClick}
      disabled={disabled && !floating}
      aria-disabled={softDisabled || undefined}
      aria-pressed={pressed}
      title={label}
      aria-label={label}
      className={`focus-ring text-ink-faint hover:text-ink rounded-[var(--radius-control)] disabled:pointer-events-none disabled:opacity-40 aria-disabled:opacity-40 ${
        floating
          ? 'border-line bg-surface pointer-events-auto flex size-7 items-center justify-center border transition-colors'
          : 'hover:bg-muted p-1'
      }`}
    >
      {children}
    </button>
  )
}
