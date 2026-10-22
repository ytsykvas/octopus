import { ArrowUp } from 'lucide-react'

interface SendButtonProps {
  /** What the button does, said aloud and in the tooltip: it has no text. */
  readonly label: string
  readonly onClick: () => void
  readonly disabled?: boolean
}

/** The small green round button that sends what has been written beside it. */
export function SendButton({ label, onClick, disabled }: SendButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="focus-ring bg-success text-on-accent hover:brightness-110 grid size-6 shrink-0 place-items-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-40"
    >
      <ArrowUp aria-hidden size={13} />
    </button>
  )
}
