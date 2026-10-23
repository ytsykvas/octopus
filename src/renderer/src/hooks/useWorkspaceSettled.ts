import { useEffect, useEffectEvent } from 'react'

import { useTurnSettled } from './useTurnSettled.js'

/**
 * Calls back when a workspace's files have probably changed: a turn of any of
 * its chats ended, or the window came back from somewhere the user might have
 * edited them.
 *
 * In place of a watcher, which octopus deliberately does not run (`docs/ui/files-tab.md`):
 * these are the moments a reader would expect the picture to be current, and
 * between them nothing on screen claims to be live. Nothing fires while
 * `enabled` is false — a hidden tab reads when it is shown again instead.
 *
 * The focus half is what the diff pane goes without: it is how an edit made in
 * another editor reaches the tree, and a tree costs one `git status` where a
 * diff costs a dozen processes on every switch back into the app.
 */
export function useWorkspaceSettled(
  workspaceId: string | null,
  enabled: boolean,
  onSettled: () => void
): void {
  useTurnSettled(workspaceId, enabled, onSettled)

  const focused = useEffectEvent(onSettled)

  useEffect(() => {
    if (workspaceId === null || !enabled) return

    const listener = (): void => {
      focused()
    }
    window.addEventListener('focus', listener)

    return () => {
      window.removeEventListener('focus', listener)
    }
  }, [workspaceId, enabled])
}
