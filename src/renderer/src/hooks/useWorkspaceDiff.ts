import { useCallback, useEffect, useRef, useState } from 'react'

import type { FileSides, WorkspaceDiff } from '@core/diff.js'

import { useErrorMessage } from './useErrorMessage.js'
import { onChatEvent } from './chatEvents.js'

export interface WorkspaceDiffController {
  readonly diff: WorkspaceDiff | null
  /**
   * Each changed file's two sides, whole, for colouring them.
   *
   * Read beside the diff rather than after it: the two describe one tree and a
   * pane holding a diff from one moment and sides from another would colour
   * lines by numbers that had moved. Empty is an ordinary answer — a workspace
   * with nothing in it, or a change too large to carry — and means the colours
   * come from the hunks alone.
   */
  readonly sides: Readonly<Record<string, FileSides>>
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
    (
      result: Awaited<ReturnType<typeof window.octopus.workspaces.diff>>,
      whole: Awaited<ReturnType<typeof window.octopus.workspaces.fileSides>>,
      attempt: number
    ) => {
      // Another workspace was opened while git was reading. Its own read has
      // started already, and writing this reply now would overwrite it.
      if (attempt !== generation.current) return

      if (result.ok) {
        setDiff(result.value)
        // A failure here is not one: the colours fall back to the hunks, and
        // the diff is what the pane is for.
        setSides(whole.ok ? whole.value : NO_SIDES)
        setError(null)
        return
      }

      setDiff(null)
      setSides(NO_SIDES)
      setError(describeFailure(result))
    },
    [describeFailure]
  )

  /* Both at once. The sides are a fifth git call beside the diff's four, all
     parallel, so asking for them costs no wall clock — and it is the only
     arrangement where the two cannot describe different trees. */
  const read = (
    id: string
  ): Promise<
    [
      Awaited<ReturnType<typeof window.octopus.workspaces.diff>>,
      Awaited<ReturnType<typeof window.octopus.workspaces.fileSides>>
    ]
  > => Promise.all([window.octopus.workspaces.diff(id), window.octopus.workspaces.fileSides(id)])

  const load = useCallback(
    async (id: string) => {
      const attempt = ++generation.current
      const [result, whole] = await read(id)
      apply(result, whole, attempt)
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
      const [result, whole] = await read(workspaceId)
      if (!controller.signal.aborted) apply(result, whole, attempt)
    })()

    return () => {
      controller.abort()
    }
  }, [workspaceId, enabled, apply])

  useEffect(() => {
    const unsubscribe = onChatEvent((announced) => {
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

  return {
    diff,
    sides,
    loading: diff === null && error === null && workspaceId !== null,
    error,
    refresh
  }
}
