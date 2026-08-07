import { useEffect, useRef } from 'react'

interface ModalProps {
  readonly title: string
  readonly onClose: () => void
  readonly children: React.ReactNode
  /** Optional row of controls pinned to the bottom. */
  readonly footer?: React.ReactNode
}

/**
 * A modal dialog.
 *
 * Built on the native `<dialog>` element, which brings focus trapping, the
 * Escape key and inertness of the page behind it for free — all of which are
 * easy to get subtly wrong by hand.
 */
export function Modal({ title, onClose, children, footer }: ModalProps): React.JSX.Element {
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
      // `cancel` covers Escape; `close` covers everything else the browser does.
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        // A click landing on the dialog itself is the backdrop: the content
        // sits in a child element and stops the event there.
        if (event.target === dialog.current) onClose()
      }}
      className="bg-canvas text-ink border-line m-auto w-[min(46rem,calc(100vw-4rem))] rounded-[var(--radius-panel)] border p-0 shadow-[var(--shadow-modal)] backdrop:bg-black/40"
    >
      <div className="flex max-h-[min(34rem,calc(100vh-8rem))] flex-col">
        <header className="border-line flex shrink-0 items-center justify-between border-b px-4 py-3">
          <h2 className="font-medium">{title}</h2>
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
