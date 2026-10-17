/**
 * A few mutually exclusive choices, side by side.
 *
 * Out of `Settings.tsx`, where it began as a private helper, because the
 * settings sources draw one too — the layers of a script or an instruction —
 * and a second copy would drift in height and padding from the first.
 *
 * `aria-pressed` on each button, so which one is chosen reaches a screen reader
 * as well as the eye, and a test has a handle on it that is not a class name.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled = false,
  size = 'md'
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  /** Names the group, for a reader that cannot see what the buttons sit beside. */
  label?: string
  /** Every button at once: the group is one control. */
  disabled?: boolean
  /**
   * `sm` stands as tall as a small `Button`, border and padding included, for a
   * row of them; `md` is the settings' own.
   */
  size?: 'sm' | 'md'
}): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label={label}
      className="border-line bg-muted inline-flex rounded-[var(--radius-control)] border p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => {
            onChange(option.value)
          }}
          className={`focus-ring rounded-[4px] font-medium transition-colors ${
            size === 'sm' ? 'h-[18px] px-2 text-[11px]' : 'h-6 px-3'
          } ${
            value === option.value ? 'bg-canvas text-ink' : 'text-ink-soft enabled:hover:text-ink'
          } disabled:pointer-events-none disabled:opacity-50`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
