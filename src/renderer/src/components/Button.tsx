import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * Button (§10.2 docs/PROJECT.md).
 *
 * Variants: accent for the primary action, success for one that starts
 * something running or finishes the work — Run, a send, a push, a merge —
 * quiet for secondary ones, danger for a subdued destructive control,
 * destructive for a filled one that leads a confirmation, and agent for one
 * that hands the work to the agent, wearing the composer's colour ring.
 * Colours go through tokens only, otherwise the dark theme breaks.
 */
export type ButtonVariant = 'accent' | 'success' | 'quiet' | 'danger' | 'destructive' | 'agent'
export type ButtonSize = 'sm' | 'md'

const VARIANTS: Record<ButtonVariant, string> = {
  accent: 'bg-accent text-on-accent hover:bg-accent-hover border-transparent',
  success: 'bg-success text-on-accent hover:brightness-110 border-transparent',
  quiet: 'bg-canvas text-ink border-line hover:bg-muted',
  danger: 'bg-transparent text-danger border-transparent hover:bg-danger-bg',
  // Filled: for the primary action of a confirmation, where it must be the
  // thing the eye lands on.
  destructive: 'bg-danger text-on-accent border-transparent hover:brightness-110',
  // `relative` because the ring is drawn by a span positioned against it.
  agent: 'ai-button relative text-ink border-transparent'
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-6 px-2 text-[11px]',
  md: 'h-7 px-3 text-[12px]'
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  readonly children: ReactNode
}

export function Button({
  variant = 'quiet',
  size = 'md',
  children,
  className = '',
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={`focus-ring inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] border font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {variant === 'agent' && <span aria-hidden className="ai-button-line" />}
      {children}
    </button>
  )
}
