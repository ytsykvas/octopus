import { GripVertical } from 'lucide-react'

export function ReorderHandle({
  label,
  onStep
}: {
  readonly label: string
  readonly onStep: (step: -1 | 1) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      onKeyDown={(event) => {
        if (!event.altKey) return
        if (event.key === 'ArrowUp') onStep(-1)
        else if (event.key === 'ArrowDown') onStep(1)
        else return

        event.preventDefault()
      }}
      className="focus-ring text-ink-faint hover:text-ink -ml-1 cursor-grab rounded-[var(--radius-control)] p-0.5"
    >
      <GripVertical aria-hidden size={14} />
    </button>
  )
}
