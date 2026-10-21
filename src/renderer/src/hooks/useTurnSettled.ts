import { useEffect, useEffectEvent } from 'react'

import { onChatEvent } from './chatEvents.js'
import { setVisibleTimeout } from './visibleTimeout.js'

/**
 * How long a read waits after a turn ends.
 *
 * A turn that fails ends twice, an error and then a result, and two chats in
 * one workspace often finish together. That is one change to the tree, and
 * should be one read — and the `result` arrives as the agent's last write is
 * still landing, so a read that beats it reports the state before it.
 */
export const SETTLE_MS = 300

/**
 * Calls back once a turn of any of the workspace's chats has ended and settled.
 *
 * Filtered on the workspace rather than the chat, since any chat in it writes
 * to the same worktree; on `error` as well as `result`, since a turn that
 * failed may well have written files, or pushed, before it did.
 *
 * Nothing fires while `enabled` is false: a hidden tab reads when it is shown
 * again instead, and a read pending when it is hidden is dropped. A turn that
 * ends while the window is hidden is held until the window is shown, and then
 * read once (`setVisibleTimeout`).
 */
export function useTurnSettled(
  workspaceId: string | null,
  enabled: boolean,
  onSettled: () => void
): void {
  // The newest callback, so a caller's fresh closure on every render does not
  // resubscribe — and drop a pending read — each time.
  const settled = useEffectEvent(onSettled)

  useEffect(() => {
    if (workspaceId === null || !enabled) return

    let cancel: (() => void) | null = null

    const unsubscribe = onChatEvent((announced) => {
      if (announced.workspaceId !== workspaceId) return
      if (announced.event.type !== 'result' && announced.event.type !== 'error') return

      cancel?.()
      cancel = setVisibleTimeout(() => {
        settled()
      }, SETTLE_MS)
    })

    return () => {
      unsubscribe()
      cancel?.()
    }
  }, [workspaceId, enabled])
}
