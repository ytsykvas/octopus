import { useCallback, useEffect, useRef, useState } from 'react'

import type { PullRequestDetail } from '@core/pullRequestShapes.js'

import { INTERVAL_MS, nextDelay, type Pushed } from './pullRequestPace.js'
import { useBranchMoved } from './useBranchMoved.js'
import { useErrorMessage } from './useErrorMessage.js'
import { useTurnSettled } from './useTurnSettled.js'
import { setVisibleTimeout } from './visibleTimeout.js'

export interface PullRequestDetailController {
  readonly detail: PullRequestDetail | null
  /** When `detail` was read, as an ISO time; null until it has been. */
  readonly readAt: string | null
  /** Nothing has been read yet, so there is nothing to draw and no failure. */
  readonly loading: boolean
  readonly error: string | null
  /** Reads again now, which the refresh control and a finished merge both do. */
  readonly refresh: () => void
}

/**
 * The checks, the review and the mergeability of one request.
 *
 * A hook of its own rather than a field on `usePullRequest`, because the two
 * reads fail differently and each has to be able to say so. `gh pr list`
 * failing means the branch cannot be described at all and the pane should
 * blank; this one failing leaves the number, the title and the link worth
 * drawing, and only the checks missing.
 *
 * `number` is null until the branch is known to have a request, which is what
 * stops this asking about one that does not exist.
 */
export function usePullRequestDetail(
  workspaceId: string | null,
  number: number | null,
  enabled: boolean
): PullRequestDetailController {
  const describeFailure = useErrorMessage()

  const [detail, setDetail] = useState<PullRequestDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * When `detail` was read, as an ISO time.
   *
   * The one thing that tells a fresh answer from a stale one. A push is heard
   * now, wherever it came from, but GitHub can still be slow to answer and a
   * read can fail — and a pane that says nothing about when it looked reads as
   * current however old it is.
   */
  const [readAt, setReadAt] = useState<string | null>(null)

  /** Bumped to ask again, which is the whole of what `refresh` does. */
  const [nonce, setNonce] = useState(0)

  /*
   * Which request the two above describe.
   *
   * Compared during render rather than reconciled in an effect, the way
   * `usePullRequest` does it: a pane showing the previous request's checks for
   * a frame would be reporting on a branch that is not the one on screen.
   */
  const key = workspaceId === null || number === null ? null : `${workspaceId}#${String(number)}`
  const [shownKey, setShownKey] = useState(key)

  if (key !== shownKey) {
    setShownKey(key)
    setDetail(null)
    setError(null)
    setReadAt(null)
  }

  /** Rejects a reply that arrived after the request changed under it. */
  const generation = useRef(0)

  /*
   * The last push heard, and which request it was heard for.
   *
   * A ref rather than state: nothing draws it, and it is written in a callback
   * and read in `read`, never during render. Never cleared either — a push
   * whose key is not the request on screen simply does not apply.
   */
  const pushed = useRef<(Pushed & { readonly key: string | null }) | null>(null)

  const refresh = useCallback(() => {
    setNonce((count) => count + 1)
  }, [])

  useEffect(() => {
    if (workspaceId === null || number === null || !enabled) return

    let stopped = false
    let cancel: (() => void) | undefined
    const attempt = ++generation.current
    // When this run of reads began: a push, a turn ending, Refresh or another
    // request re-runs the effect, and with it the ten minutes of the fast clock.
    const since = Date.now()

    const read = async (): Promise<void> => {
      const result = await window.octopus.workspaces.pullRequestDetail(workspaceId, number)
      if (stopped || attempt !== generation.current) return

      if (!result.ok) {
        setError(describeFailure(result))
        return
      }

      setDetail(result.value)
      setError(null)
      setReadAt(new Date().toISOString())

      // Rescheduled from the answer rather than run on an interval: an interval
      // would stack a second read on top of one still in flight over a slow
      // connection, and there is nothing to wait for once everything has
      // settled. Held while the window is hidden: a check finishing behind it
      // is read once, when somebody can see the answer.
      const current = pushed.current?.key === key ? pushed.current : null
      const delay = nextDelay(result.value, current, Date.now(), since)
      if (delay === null) return

      // A hurried read is a step along the back-off; the ordinary clock is not.
      if (current !== null && delay < INTERVAL_MS) {
        pushed.current = { ...current, reads: current.reads + 1 }
      }
      cancel = setVisibleTimeout(() => void read(), delay)
    }

    void read()

    return () => {
      stopped = true
      cancel?.()
    }
    // `nonce` is not read in here; it is what makes a refresh re-run the effect.
  }, [workspaceId, number, enabled, nonce, describeFailure, key])

  /*
   * Read again when a turn ends in this workspace.
   *
   * `settling` stops the poll the moment nothing is pending — and a check that
   * has **failed** is not pending. So the pane went quiet at exactly the moment
   * a fix was on its way, and an agent pushing that fix in its own worktree
   * raised nothing this hook listened to. The pane whose job is saying whether
   * the fix worked was the one that had stopped looking.
   *
   * The diff pane's subscription, shared through `useTurnSettled`: skipped
   * while the tab is hidden, since the effect above reads again when it comes
   * back, and held while the window is.
   *
   * Not a poll while a check is failed, which was the other candidate: that
   * asks GitHub about an abandoned request for ever, which is what `settling`
   * exists to prevent.
   */
  useTurnSettled(workspaceId, enabled && number !== null, refresh)

  /*
   * Read the moment the branch moves on the remote — the agent's push, the
   * terminal's, the one opening a request makes — and hurry until GitHub has
   * caught up with it (`nextDelay`).
   */
  useBranchMoved(workspaceId, enabled && number !== null, (head) => {
    pushed.current = { key, head, at: Date.now(), reads: 0 }
    refresh()
  })

  return {
    detail,
    readAt,
    loading: detail === null && error === null && key !== null,
    error,
    refresh
  }
}
