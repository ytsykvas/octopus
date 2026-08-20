import { useCallback, useEffect, useState } from 'react'

import type { BranchRequest } from '@core/pullRequestShapes.js'

export interface BranchRequestController {
  /** What each branch's request is, by branch name; absent means there is none. */
  readonly byBranch: ReadonlyMap<string, BranchRequest>
  /** Reads again — after one is opened here, or merged. */
  readonly refresh: () => void
}

/**
 * How often to look again while a project is open.
 *
 * Slower than the pull request tab's own timer by four times, and deliberately:
 * this one runs whenever a project is open rather than when somebody is looking
 * at a request, and what it feeds is a mark on a row rather than a number
 * anybody is waiting on.
 */
const INTERVAL_MS = 60_000

/**
 * Every branch of a project that has a pull request.
 *
 * One call for the whole project rather than one per workspace. The mark is
 * wanted on every row of the list at once, and a read per row would be a
 * network call per row on every refresh — which is the reason the pull request
 * tab reads only for the workspace showing.
 *
 * A failure is silent. There is no room on a list row to explain one, the tab
 * says it properly when it is opened, and a repository with no GitHub remote is
 * an ordinary thing rather than a fault: what the reader sees is no marks,
 * which is also what a project with no requests looks like.
 */
export function useBranchRequests(projectId: string | null): BranchRequestController {
  const [byBranch, setByBranch] = useState<ReadonlyMap<string, BranchRequest>>(new Map())

  /** Bumped to ask again, which is the whole of what `refresh` does. */
  const [nonce, setNonce] = useState(0)

  /*
   * Which project the map above describes.
   *
   * Compared during render rather than reconciled in an effect: a list showing
   * the previous project's marks for a frame would be putting a green branch
   * beside a workspace that has no request at all.
   */
  const [shownId, setShownId] = useState(projectId)

  if (projectId !== shownId) {
    setShownId(projectId)
    setByBranch(new Map())
  }

  const refresh = useCallback(() => {
    setNonce((count) => count + 1)
  }, [])

  useEffect(() => {
    if (projectId === null) return

    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const read = async (): Promise<void> => {
      const result = await window.octopus.projects.pullRequests(projectId)
      if (stopped) return

      if (result.ok) {
        setByBranch(new Map(result.value.map((request) => [request.branch, request])))
      }

      // Rescheduled from the answer rather than run on an interval, so a slow
      // reply never has a second read stacked on top of it — and a refusal is
      // retried on the same clock rather than giving up for the session.
      timer = setTimeout(() => void read(), INTERVAL_MS)
    }

    void read()

    return () => {
      stopped = true
      clearTimeout(timer)
    }
    // `nonce` is not read in here; it is what makes a refresh re-run the effect.
  }, [projectId, nonce])

  return { byBranch, refresh }
}
