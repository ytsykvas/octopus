/**
 * The search field over both tabs, pinned while the list scrolls under it —
 * opaque for that reason, the same as the repository picker's.
 */
export function PluginSearch({
  value,
  onChange,
  placeholder,
  children
}: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder: string
  /** Anything that filters beside the text, drawn under it. */
  readonly children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="border-line bg-canvas sticky top-0 z-10 space-y-2 border-b p-3">
      <input
        type="search"
        // Both: the mark for the dialog's opening, when `autoFocus` fires too
        // early (see `Modal`), and `autoFocus` for a search that mounts into a
        // dialog already open — the other tab, or a list that answered late.
        data-autofocus
        autoFocus
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        spellCheck={false}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className="input focus-ring"
      />
      {children}
    </div>
  )
}
