import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * Кнопка дизайн-системи (§10.2).
 *
 * Бордер 3px, радіус 12px, тінь 6px зі зсувом на hover і «натисканням»
 * на active. Кольори тільки через токени — інакше зламається темна тема.
 */
export type ButtonTone = 'success' | 'danger' | 'primary' | 'neutral'

const TONE_CLASSES: Record<ButtonTone, string> = {
  success: 'bg-success text-on-success',
  danger: 'bg-danger text-on-danger',
  primary: 'bg-primary text-on-primary',
  neutral: 'bg-muted text-ink'
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly tone?: ButtonTone
  readonly children: ReactNode
}

export function Button({
  tone = 'neutral',
  children,
  className = '',
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={`brutal-label brutal-interactive border-outline rounded-[var(--radius-brutal)] border-[3px] px-5 py-2 text-xs shadow-[var(--shadow-brutal)] disabled:cursor-not-allowed disabled:opacity-60 ${TONE_CLASSES[tone]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
