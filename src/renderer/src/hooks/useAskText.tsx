import { useCallback, useRef, useState } from 'react'

import { Button } from '../components/Button.js'
import { Modal } from '../components/Modal.js'

export interface AskTextRequest {
  readonly title: string
  /** The label on the field, which is the whole of the question. */
  readonly label: string
  readonly confirmLabel: string
  readonly cancelLabel: string
  /** What the field starts with; empty for a name being invented. */
  readonly initial?: string
  /**
   * Whether what is typed may be sent.
   *
   * Supplied by the caller rather than fixed here, because the rule belongs to
   * whatever is being named — and applying it as the field is typed is the
   * whole point: a round trip spent on a name the boundary will refuse tells
   * the reader nothing they could not have been told at once.
   */
  readonly valid: (value: string) => boolean
  /** Shown under the field while `valid` says no and something has been typed. */
  readonly invalid: string
}

interface AskText {
  /** Resolves with the trimmed text, or null when cancelled. */
  readonly ask: (request: AskTextRequest) => Promise<string | null>
  /** Render this somewhere in the tree; it is null while nothing is pending. */
  readonly dialog: React.JSX.Element | null
}

/**
 * Asks the user for one line of text.
 *
 * The sibling of `useConfirm`, and it exists for the reason that one states:
 * "In-app rather than the system dialog: a native alert cannot be styled, so it
 * arrives as a visitor from another application."
 *
 * The one place that did use the system dialog could not have worked. Electron
 * replaces `window.prompt` at renderer start-up with a function that **throws**
 * — for every protocol this window loads, in dev and in the build alike — and
 * the throw was the first statement of an async function called as `void`, so
 * the rejection went nowhere: no dialog, no IPC call, no banner, and a console
 * line nobody sees. Every test mocked `window.prompt` and jsdom supplied a stub
 * that let the spy install, so the suite was green over a path that cannot run
 * outside jsdom.
 *
 * `useConfirm` was not a drop-in — it has no field — which is the only reason
 * this is a second hook rather than an option on that one.
 */
export function useAskText(): AskText {
  const [request, setRequest] = useState<AskTextRequest | null>(null)
  const [value, setValue] = useState('')
  // Held in a ref because the promise outlives the render that created it.
  const settle = useRef<((answer: string | null) => void) | null>(null)

  const ask = useCallback((next: AskTextRequest) => {
    setRequest(next)
    // This question's own starting text, not what the last one was left with.
    setValue(next.initial ?? '')
    return new Promise<string | null>((resolve) => {
      settle.current = resolve
    })
  }, [])

  const close = useCallback(
    (answer: string | null) => {
      setRequest(null)
      settle.current?.(answer)
      settle.current = null
    },
    [settle]
  )

  const trimmed = value.trim()
  const allowed = request?.valid(trimmed) === true

  const dialog =
    request === null ? null : (
      <Modal
        size="sm"
        title={request.title}
        onClose={() => {
          close(null)
        }}
        footer={
          <>
            <Button
              variant="quiet"
              onClick={() => {
                close(null)
              }}
            >
              {request.cancelLabel}
            </Button>
            <Button
              variant="accent"
              disabled={!allowed}
              onClick={() => {
                close(trimmed)
              }}
            >
              {request.confirmLabel}
            </Button>
          </>
        }
      >
        <div className="space-y-2 p-5">
          <label className="block space-y-1.5">
            <span className="text-ink-soft">{request.label}</span>
            <input
              autoFocus
              value={value}
              spellCheck={false}
              onChange={(event) => {
                setValue(event.target.value)
              }}
              // Enter sends, as it does everywhere else a single line is asked
              // for — and only when the answer would be taken, or the key would
              // appear to do nothing for a reason nothing on screen explains.
              onKeyDown={(event) => {
                if (event.key === 'Enter' && allowed) close(trimmed)
              }}
              className="input focus-ring w-full font-mono"
            />
          </label>

          {/* Only once something has been typed: a rule stated over an empty
              field reads as a complaint about not having started yet. */}
          {trimmed !== '' && !allowed && <p className="text-danger">{request.invalid}</p>}
        </div>
      </Modal>
    )

  return { ask, dialog }
}
