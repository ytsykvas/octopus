import { AlertTriangle } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

import { Button } from '../components/Button.js'
import { Modal } from '../components/Modal.js'

export interface ConfirmRequest {
  readonly title: string
  readonly message: string
  readonly detail?: string
  readonly confirmLabel: string
  readonly cancelLabel: string
  /** Colours the confirm button as dangerous and shows a warning mark. */
  readonly destructive?: boolean
  /**
   * An extra choice whose value comes back on confirm.
   *
   * `checked` is where it starts, off unless the caller says otherwise: a box
   * that begins ticked is for the answer people give nearly every time, and
   * only for one they can see and undo before confirming.
   */
  readonly checkbox?: { readonly label: string; readonly checked?: boolean }
}

export interface ConfirmResult {
  readonly confirmed: boolean
  /** State of the optional checkbox; false when there was none. */
  readonly checked: boolean
}

interface Confirmation {
  /** Resolves with the answer and the state of the optional checkbox. */
  readonly confirm: (request: ConfirmRequest) => Promise<ConfirmResult>
  /** Render this somewhere in the tree; it is null while nothing is pending. */
  readonly dialog: React.JSX.Element | null
}

/**
 * Asks the user to confirm something.
 *
 * In-app rather than the system dialog: a native alert cannot be styled, so it
 * arrives as a visitor from another application. The trade-off is that button
 * placement is ours to get right — cancel sits left of confirm, and cancel is
 * what the Escape key does.
 */
export function useConfirm(): Confirmation {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const [checked, setChecked] = useState(false)
  // Held in a ref because the promise outlives the render that created it.
  const settle = useRef<((result: ConfirmResult) => void) | null>(null)

  const confirm = useCallback((next: ConfirmRequest) => {
    setRequest(next)
    // Reset to this question's own starting state rather than to off: a tick
    // left over from the previous one would arm an action nobody chose.
    setChecked(next.checkbox?.checked ?? false)
    return new Promise<ConfirmResult>((resolve) => {
      settle.current = resolve
    })
  }, [])

  const close = useCallback(
    (confirmed: boolean) => {
      setRequest(null)
      settle.current?.({ confirmed, checked: confirmed && checked })
      settle.current = null
    },
    [checked]
  )

  const dialog =
    request === null ? null : (
      <Modal
        size="sm"
        title={request.title}
        onClose={() => {
          close(false)
        }}
        footer={
          <>
            <Button
              variant="quiet"
              onClick={() => {
                close(false)
              }}
            >
              {request.cancelLabel}
            </Button>
            <Button
              variant={request.destructive === true ? 'destructive' : 'accent'}
              autoFocus
              onClick={() => {
                close(true)
              }}
            >
              {request.confirmLabel}
            </Button>
          </>
        }
      >
        <div className="flex gap-3 p-5">
          {request.destructive === true && (
            <span
              aria-hidden
              className="bg-danger-bg text-danger flex size-8 shrink-0 items-center justify-center rounded-full"
            >
              <AlertTriangle size={16} />
            </span>
          )}

          <div className="min-w-0">
            <p className="font-medium">{request.message}</p>
            {request.detail !== undefined && (
              <p className="text-ink-soft mt-1.5 leading-relaxed">{request.detail}</p>
            )}

            {request.checkbox !== undefined && (
              <label className="mt-3 flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    setChecked(event.target.checked)
                  }}
                  className="focus-ring accent-danger"
                />
                <span className="text-ink-soft">{request.checkbox.label}</span>
              </label>
            )}
          </div>
        </div>
      </Modal>
    )

  return { confirm, dialog }
}
