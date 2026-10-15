import { useEffect, useRef } from 'react'

import { onChatEvent } from './chatEvents.js'

/**
 * How long a read waits after a turn ends — the diff's own settle, for the
 * same reason: a turn that fails ends twice, an error and then a result, and
 * two chats in one workspace often finish together. That is one change to the
 * tree, and should be one read.
 */
export const SETTLE_MS = 300

/**
 * Calls back when a workspace's files have probably changed: a turn of any of
 * its chats ended, or the window came back from somewhere the user might have
 * edited them.
 *
 * In place of a watcher, which octopus deliberately does not run (`docs/ui.md`):
 * these are the moments a reader would expect the picture to be current, and
 * between them nothing on screen claims to be live. Nothing fires while
 * `enabled` is false — a hidden tab reads when it is shown again instead.
 */
export function useWorkspaceSettled(
  workspaceId: string | null,
  enabled: boolean,
  onSettled: () => void
): void {
  // The newest callback, so a caller's fresh closure on every render does not
  // resubscribe — and drop a pending read — each time.
  const latest = useRef(onSettled)
  useEffect(() => {
    latest.current = onSettled
  })

  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (workspaceId === null || !enabled) return

    const unsubscribe = onChatEvent((announced) => {
      // Any chat of the workspace writes to the same worktree.
      if (announced.workspaceId !== workspaceId) return
      if (announced.event.type !== 'result' && announced.event.type !== 'error') return

      if (pending.current !== null) clearTimeout(pending.current)
      pending.current = setTimeout(() => {
        pending.current = null
        latest.current()
      }, SETTLE_MS)
    })

    const focused = (): void => {
      latest.current()
    }
    window.addEventListener('focus', focused)

    return () => {
      unsubscribe()
      window.removeEventListener('focus', focused)
      if (pending.current !== null) clearTimeout(pending.current)
      pending.current = null
    }
  }, [workspaceId, enabled])
}
