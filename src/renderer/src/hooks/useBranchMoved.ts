import { useEffect, useEffectEvent } from 'react'

import { onBranchMoved } from './branchMoves.js'
import { setVisibleTimeout } from './visibleTimeout.js'

/**
 * Calls back with the commit when the workspace's branch moves on the remote —
 * a push, from the agent, the terminal or `gh pr create`.
 *
 * The twin of `useTurnSettled`, and gated the same way: nothing while `enabled`
 * is false, and a move while the window is hidden is held until it is shown.
 * No settling delay of its own: the watch in main has already gathered git's
 * burst of writes into one.
 */
export function useBranchMoved(
  workspaceId: string | null,
  enabled: boolean,
  onMoved: (head: string) => void
): void {
  // The newest callback, so a caller's fresh closure on every render does not
  // resubscribe — and drop a pending call — each time.
  const moved = useEffectEvent(onMoved)

  useEffect(() => {
    if (workspaceId === null || !enabled) return

    let cancel: (() => void) | null = null

    const unsubscribe = onBranchMoved((event) => {
      if (event.workspaceId !== workspaceId) return

      cancel?.()
      cancel = setVisibleTimeout(() => {
        moved(event.head)
      }, 0)
    })

    return () => {
      unsubscribe()
      cancel?.()
    }
  }, [workspaceId, enabled])
}
