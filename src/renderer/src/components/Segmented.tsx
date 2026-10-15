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
  label
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  /** Names the group, for a reader that cannot see what the buttons sit beside. */
  label?: string
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
          onClick={() => {
            onChange(option.value)
          }}
          className={`focus-ring h-6 rounded-[4px] px-3 font-medium transition-colors ${
            value === option.value ? 'bg-canvas text-ink' : 'text-ink-soft hover:text-ink'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
