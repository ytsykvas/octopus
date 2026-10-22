import { useCallback, useEffect, useRef, useState } from 'react'

import type { FileSides, WorkspaceDiff } from '@core/diff.js'

import { useErrorMessage } from './useErrorMessage.js'
import { useTurnSettled } from './useTurnSettled.js'

export interface WorkspaceDiffController {
  readonly diff: WorkspaceDiff | null
  /**
   * Each changed file's two sides, whole, for colouring them.
   *
   * From the same read as the diff: the two describe one tree, and a pane
   * holding a diff from one moment and sides from another would colour lines
   * by numbers that had moved. Empty is an ordinary answer — a workspace with
   * nothing in it, or a change too large to carry — and means the colours come
   * from the hunks alone.
   */
  readonly sides: Readonly<Record<string, FileSides>>
  /** Nothing has been read yet, so there is nothing to draw and no failure. */
  readonly loading: boolean
  readonly error: string | null
  readonly refresh: () => Promise<void>
}

/** Shared so an empty answer stays the same object and colours nothing twice. */
const NO_SIDES: Readonly<Record<string, FileSides>> = {}

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
  const [sides, setSides] = useState<Readonly<Record<string, FileSides>>>(NO_SIDES)
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
    setSides(NO_SIDES)
    setError(null)
  }

  /** Rejects a reply that arrived after the workspace changed under it. */
  const generation = useRef(0)

  const apply = useCallback(
    (result: Awaited<ReturnType<typeof window.octopus.workspaces.changes>>, attempt: number) => {
      // Another workspace was opened while git was reading. Its own read has
      // started already, and writing this reply now would overwrite it.
      if (attempt !== generation.current) return

      if (result.ok) {
        setDiff(result.value.diff)
        setSides(result.value.sides)
        setError(null)
        return
      }

      setDiff(null)
      setSides(NO_SIDES)
      setError(describeFailure(result))
    },
    [describeFailure]
  )

  const load = useCallback(
    async (id: string) => {
      const attempt = ++generation.current
      apply(await window.octopus.workspaces.changes(id), attempt)
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
      const result = await window.octopus.workspaces.changes(workspaceId)
      if (!controller.signal.aborted) apply(result, attempt)
    })()

    return () => {
      controller.abort()
    }
  }, [workspaceId, enabled, apply])

  // Behind a hidden tab there is nobody to show it to, and the effect above
  // reads again when the tab comes back.
  useTurnSettled(workspaceId, enabled, () => void refresh())

  return {
    diff,
    sides,
    loading: diff === null && error === null && workspaceId !== null,
    error,
    refresh
  }
}
