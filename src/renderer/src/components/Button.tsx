import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * Button (§10.2 docs/PROJECT.md).
 *
 * Three variants cover the whole interface: accent for the primary action,
 * quiet for secondary ones, danger for destructive ones. Colours go through
 * tokens only, otherwise the dark theme breaks.
 */
export type ButtonVariant = 'accent' | 'quiet' | 'danger'
export type ButtonSize = 'sm' | 'md'

const VARIANTS: Record<ButtonVariant, string> = {
  accent: 'bg-accent text-on-accent hover:bg-accent-hover border-transparent',
  quiet: 'bg-canvas text-ink border-line hover:bg-muted',
  danger: 'bg-transparent text-danger border-transparent hover:bg-danger-bg'
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
      {children}
    </button>
  )
}
