import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * Кнопка (§10.2 docs/PROJECT.md).
 *
 * Три варіанти, яких вистачає всьому інтерфейсу: акцентна для головної дії,
 * тиха для другорядних, небезпечна для руйнівних. Кольори лише через токени —
 * інакше зламається темна тема.
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
