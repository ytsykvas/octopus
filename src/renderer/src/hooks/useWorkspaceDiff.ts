import { useCallback, useEffect, useRef, useState } from 'react'

import type { WorkspaceDiff } from '@core/diff.js'

import { useErrorMessage } from './useErrorMessage.js'

export interface WorkspaceDiffController {
  readonly diff: WorkspaceDiff | null
  /** Nothing has been read yet, so there is nothing to draw and no failure. */
  readonly loading: boolean
  readonly error: string | null
  readonly refresh: () => Promise<void>
}

/**
 * How long the diff waits after a turn ends before reading git.
 *
 * Long enough that a turn ending twice over — an error and then a result — is
 * one read rather than two, and short enough that the pane is current by the
 * time the eye reaches it.
 */
const SETTLE_MS = 300

/**
 * What a workspace has changed, kept in step with the agent.
 *
 * `enabled` is what stops git running for a pane nobody is looking at. A turn
 * finishing behind a hidden tab is ignored, and the read happens when the tab
 * is next shown — so the pane is never behind when it is read, and never busy
 * when it is not.
 */
export function useWorkspaceDiff(
  workspaceId: string | null,
  enabled: boolean
): WorkspaceDiffController {
  const describeFailure = useErrorMessage()

  const [diff, setDiff] = useState<WorkspaceDiff | null>(null)
  const [error, setError] = useState<string | null>(null)

  /*
   * The workspace the two above describe.
   *
   * Compared during render rather than reconciled in an effect: a pane that
   * spent a frame showing the previous workspace's diff would be stating
   * something false about the one now open, and the eye catches it.
   */
  const [shownId, setShownId] = useState(workspaceId)

  if (workspaceId !== shownId) {
    setShownId(workspaceId)
    setDiff(null)
    setError(null)
  }

  /** Rejects a reply that arrived after the workspace changed under it. */
  const generation = useRef(0)

  /*
   * The one read that is waiting to happen.
   *
   * Replaced rather than added to: a turn that fails emits an error and then a
   * result, and two chats in one workspace regularly finish together. Each of
   * those is one change to the tree, and a timer per event would read it once
   * per event — which is the thing waiting was meant to avoid.
   *
   * A ref rather than a variable in the effect, because a local assigned only
   * inside the callback reads as a constant to the type checker at the two
   * places that have to test it.
   */
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)

  const apply = useCallback(
    (result: Awaited<ReturnType<typeof window.octopus.workspaces.diff>>, attempt: number) => {
      // Another workspace was opened while git was reading. Its own read has
      // started already, and writing this reply now would overwrite it.
      if (attempt !== generation.current) return

      if (result.ok) {
        setDiff(result.value)
        setError(null)
        return
      }

      setDiff(null)
      setError(describeFailure(result))
    },
    [describeFailure]
  )

  const load = useCallback(
    async (id: string) => {
      const attempt = ++generation.current
      apply(await window.octopus.workspaces.diff(id), attempt)
    },
    [apply]
  )

  const refresh = useCallback(async () => {
    if (workspaceId === null) return
    await load(workspaceId)
  }, [workspaceId, load])

  // Read inline rather than through `load`, so nothing sets state until the
  // first await has passed — a synchronous setState in an effect body is what
  // the cascading-render rule forbids.
  useEffect(() => {
    if (workspaceId === null || !enabled) return

    const controller = new AbortController()
    const attempt = ++generation.current

    void (async () => {
      const result = await window.octopus.workspaces.diff(workspaceId)
      if (!controller.signal.aborted) apply(result, attempt)
    })()

    return () => {
      controller.abort()
    }
  }, [workspaceId, enabled, apply])

  useEffect(() => {
    const unsubscribe = window.octopus.chats.onEvent((announced) => {
      // Any chat in this workspace writes to the same worktree, so this filters
      // on the workspace rather than on the chat the way `useChat` does.
      if (announced.workspaceId !== workspaceId) return
      // A turn ends either way, and one that failed may well have written
      // files before it did.
      if (announced.event.type !== 'result' && announced.event.type !== 'error') return

      // Behind a hidden tab there is nobody to show it to, and the effect
      // above reads again when the tab comes back.
      if (!enabled) return

      if (pending.current !== null) clearTimeout(pending.current)
      pending.current = setTimeout(() => {
        void load(announced.workspaceId)
      }, SETTLE_MS)
    })

    return () => {
      unsubscribe()
      if (pending.current !== null) clearTimeout(pending.current)
    }
  }, [workspaceId, enabled, load])

  return { diff, loading: diff === null && error === null && workspaceId !== null, error, refresh }
}
