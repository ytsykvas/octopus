import { AlertTriangle, Info } from 'lucide-react'

/**
 * A sentence the reader should see before pressing: something that will happen
 * (`info`) or something that could go wrong (`warning`), on its paired ground.
 */
export function Callout({
  tone,
  children
}: {
  readonly tone: 'info' | 'warning'
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <p
      className={`text-ink flex items-start gap-2 rounded-[var(--radius-control)] px-2.5 py-2 leading-snug ${
        tone === 'info' ? 'bg-info-bg' : 'bg-warning-bg'
      }`}
    >
      <span
        className={`flex h-[1lh] shrink-0 items-center ${tone === 'info' ? 'text-info' : 'text-warning'}`}
      >
        {tone === 'info' ? <Info aria-hidden size={13} /> : <AlertTriangle aria-hidden size={13} />}
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  )
}
