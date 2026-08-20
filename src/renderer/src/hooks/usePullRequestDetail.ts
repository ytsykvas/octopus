import { useCallback, useEffect, useRef, useState } from 'react'

import type { PullRequestDetail } from '@core/pullRequestShapes.js'

import { useErrorMessage } from './useErrorMessage.js'

export interface PullRequestDetailController {
  readonly detail: PullRequestDetail | null
  /** Nothing has been read yet, so there is nothing to draw and no failure. */
  readonly loading: boolean
  readonly error: string | null
  /** Reads again now, which the refresh control and a finished merge both do. */
  readonly refresh: () => void
}

/**
 * How often to look again while something is still moving.
 *
 * Long enough that a tab left open is not a request a second, short enough that
 * a check finishing is noticed in the time it takes to look away and back.
 */
const INTERVAL_MS = 15_000

/**
 * Whether there is anything left to wait for.
 *
 * The mergeability half is not an afterthought. GitHub computes it
 * asynchronously, so the first read after every push says `unknown` — and a
 * request whose repository runs no CI has no pending check to wait on either.
 * Polling on the checks alone would leave both of those unknown for ever.
 */
function settling(detail: PullRequestDetail): boolean {
  return detail.checks.some((check) => check.state === 'pending') || detail.mergeable === 'unknown'
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
  }

  /** Rejects a reply that arrived after the request changed under it. */
  const generation = useRef(0)

  const refresh = useCallback(() => {
    setNonce((count) => count + 1)
  }, [])

  useEffect(() => {
    if (workspaceId === null || number === null || !enabled) return

    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const attempt = ++generation.current

    const read = async (): Promise<void> => {
      const result = await window.octopus.workspaces.pullRequestDetail(workspaceId, number)
      if (stopped || attempt !== generation.current) return

      if (!result.ok) {
        setError(describeFailure(result))
        return
      }

      setDetail(result.value)
      setError(null)

      // Rescheduled from the answer rather than run on an interval: an interval
      // would stack a second read on top of one still in flight over a slow
      // connection, and there is nothing to wait for once everything has
      // settled.
      if (settling(result.value)) timer = setTimeout(() => void read(), INTERVAL_MS)
    }

    void read()

    return () => {
      stopped = true
      clearTimeout(timer)
    }
    // `nonce` is not read in here; it is what makes a refresh re-run the effect.
  }, [workspaceId, number, enabled, nonce, describeFailure])

  return {
    detail,
    loading: detail === null && error === null && key !== null,
    error,
    refresh
  }
}
