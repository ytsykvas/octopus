import { useCallback, useEffect, useState } from 'react'

/** What the last copy did, which is all a control has to say about it. */
export type CopyState = 'idle' | 'done' | 'failed'

/** How long the outcome is reported before the control goes quiet again. */
export const COPY_SETTLE_MS = 2000

/**
 * Writes text to the clipboard and remembers, for a moment, how that went.
 *
 * The failure is kept rather than swallowed: a refused clipboard is real — an
 * unfocused document is enough — and an action that quietly did nothing is
 * worse than one that says so. The outcome clears on its own, and its timer
 * with the component: a control still claiming a copy happened is describing a
 * clipboard that has moved on.
 */
export function useCopy(): {
  readonly state: CopyState
  readonly copy: (text: string) => Promise<void>
} {
  const [state, setState] = useState<CopyState>('idle')

  useEffect(() => {
    if (state === 'idle') return

    const timer = setTimeout(() => {
      setState('idle')
    }, COPY_SETTLE_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [state])

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setState('done')
    } catch {
      setState('failed')
    }
  }, [])

  return { state, copy }
}
