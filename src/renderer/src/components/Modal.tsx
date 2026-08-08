import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

interface ModalProps {
  readonly title: string
  readonly onClose: () => void
  readonly children: React.ReactNode
  /** Optional row of controls pinned to the bottom. */
  readonly footer?: React.ReactNode
  /** `sm` for a question, `md` for a list, `lg` for a form with sections. */
  readonly size?: 'sm' | 'md' | 'lg'
}

const WIDTHS = {
  sm: 'w-[min(26rem,calc(100vw-4rem))]',
  md: 'w-[min(46rem,calc(100vw-4rem))]',
  lg: 'w-[min(62rem,calc(100vw-4rem))]'
} as const

/**
 * How tall the body may grow before it scrolls.
 *
 * A question needs little and looks wrong stretched; a sectioned form with
 * script bodies in it needs most of the window, and capping it at the height of
 * a dialog meant for two lines of text is what made everything feel cramped.
 */
const HEIGHTS = {
  sm: 'max-h-[min(24rem,calc(100vh-8rem))]',
  md: 'max-h-[min(34rem,calc(100vh-8rem))]',
  lg: 'max-h-[min(46rem,calc(100vh-6rem))]'
} as const

/**
 * A modal dialog.
 *
 * Built on the native `<dialog>` element, which brings focus trapping, the
 * Escape key and inertness of the page behind it for free — all of which are
 * easy to get subtly wrong by hand.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  size = 'md'
}: ModalProps): React.JSX.Element {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialog.current
    if (!element) return

    element.showModal()
    return () => {
      element.close()
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      aria-label={title}
      // `cancel` is Escape. A click on the backdrop deliberately does nothing:
      // these dialogs hold edits and confirmations, and a stray click beside
      // one should not discard what is in it. Closing is what the footer button
      // and Escape are for — both of them things you mean to do.
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      className={`bg-canvas text-ink border-line m-auto rounded-[var(--radius-panel)] border p-0 shadow-[var(--shadow-modal)] backdrop:bg-black/40 ${WIDTHS[size]}`}
    >
      <div className={`flex flex-col ${HEIGHTS[size]}`}>
        <header className="border-line flex shrink-0 items-center gap-3 border-b px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate font-medium">{title}</h2>

          {/* Now that the backdrop no longer dismisses, a visible way out has
              to exist for anyone not reaching for Escape. */}
          <button
            type="button"
            onClick={onClose}
            title={t('modal.close')}
            aria-label={t('modal.close')}
            className="text-ink-faint hover:text-ink focus-ring -mr-1 shrink-0 rounded p-1 transition-colors"
          >
            <X aria-hidden size={14} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">{children}</div>

        {footer !== undefined && (
          <footer className="border-line flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </dialog>
  )
}
