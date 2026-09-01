interface SwitchProps {
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  /** Names the control; the row's own text is the label beside it, not on it. */
  readonly label: string
  readonly disabled?: boolean
}

/**
 * On or off, as a control that says which without a word.
 *
 * The interface had two idioms for this and neither fits a list. `.choice` is a
 * checkbox, which reads as "include this in what I am about to do" rather than
 * as a state something is already in; the tinted chip in the composer's footer
 * carries its own label and cannot be put beside somebody else's.
 *
 * A `button` with `role="switch"` rather than an `input`: what it toggles is a
 * setting that applies at once, not a field waiting for a form to be submitted,
 * and the row it sits in is not a form.
 *
 * The colours are `.choice`'s exactly — a hairline against the canvas when off,
 * the accent filled when on — so the two read as the same family in a dialog
 * that shows both.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false
}: SwitchProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        onChange(!checked)
      }}
      className={`focus-ring relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors disabled:pointer-events-none disabled:opacity-55 ${
        checked ? 'border-accent bg-accent' : 'border-line-strong bg-canvas hover:border-accent'
      }`}
    >
      <span
        aria-hidden
        className={`block size-2.5 rounded-full transition-transform ${
          checked ? 'bg-on-accent translate-x-3.5' : 'bg-ink-faint translate-x-0.5'
        }`}
      />
    </button>
  )
}
