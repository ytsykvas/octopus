import { useCallback, useEffect, useMemo, useState } from 'react'

import type { BranchRequest } from '@core/pullRequestShapes.js'

export interface BranchRequestController {
  /** What each branch's request is, by branch name; absent means there is none. */
  readonly byBranch: ReadonlyMap<string, BranchRequest>
  /**
   * Whether the answer came back full, and so may be missing older requests.
   *
   * Absent from this map means "no request" only when this is false. The read
   * asks for the hundred most recent, so a workspace whose request is older is
   * not in the answer — and the header must stop naming an action it cannot
   * know is the right one.
   */
  readonly capped: boolean
  /**
   * Whether any answer has come back for this project yet, refused or not.
   *
   * Before one has, `capped` is only its starting value: a caller treating that
   * as "not capped" shows an action on a large repository and then withdraws it
   * once the read lands.
   */
  readonly answered: boolean
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
 * How often to look again while some request still has a check running.
 *
 * The pull request tab reads on this clock, and the mark on a row is the same
 * fact: left at a minute, the row kept spinning for up to a minute after the tab
 * had already said the checks were done. Only while something is running, so a
 * project with nothing in flight costs what it did.
 */
export const RUNNING_INTERVAL_MS = 15_000

/** One project's answer: its requests by branch, and whether the list came back full. */
interface ProjectAnswer {
  readonly byBranch: ReadonlyMap<string, BranchRequest>
  readonly capped: boolean
}

const NONE: ReadonlyMap<string, BranchRequest> = new Map()

export interface BranchRequestsController extends BranchRequestController {
  /**
   * Every watched project's requests by branch, the open one's included.
   *
   * What the status bar counts across projects. A project that has not
   * answered yet is absent, which the bar reads as "nothing to count".
   */
  readonly byProject: ReadonlyMap<string, ReadonlyMap<string, BranchRequest>>
}

/**
 * Every branch of a project that has a pull request — the open one, and any
 * others the caller wants watched.
 *
 * One call per project rather than one per workspace. The mark is wanted on
 * every row of the list at once, and a read per row would be a network call
 * per row on every refresh — which is the reason the pull request tab reads
 * only for the workspace showing.
 *
 * The other projects are the status bar's, and they ride on this one clock
 * rather than a second poller of its own: two of them would ask `gh` about the
 * open project twice a minute. The caller passes them only while the bar is
 * showing, so folding the bar away is folding the cost away with it.
 *
 * A failure is silent. There is no room on a list row to explain one, the tab
 * says it properly when it is opened, and a repository with no GitHub remote is
 * an ordinary thing rather than a fault: what the reader sees is no marks,
 * which is also what a project with no requests looks like.
 */
export function useBranchRequests(
  projectId: string | null,
  alsoWatch: readonly string[] = []
): BranchRequestsController {
  /*
   * Kept per project, so the open project's view is a lookup rather than a
   * reset: a list showing the previous project's marks for a frame would put a
   * green branch beside a workspace that has no request at all, and a lookup
   * by the project now open cannot.
   */
  const [answers, setAnswers] = useState<ReadonlyMap<string, ProjectAnswer>>(new Map())

  /** Bumped to ask again, which is the whole of what `refresh` does. */
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => {
    setNonce((count) => count + 1)
  }, [])

  /*
   * The watched set as one string, so a caller handing a fresh array each
   * render with the same projects in it does not restart every read.
   */
  const watched = [...new Set([...(projectId === null ? [] : [projectId]), ...alsoWatch])].join(
    '\n'
  )

  useEffect(() => {
    if (watched === '') return

    let stopped = false
    const timers = new Map<string, ReturnType<typeof setTimeout>>()

    const read = async (id: string): Promise<void> => {
      const result = await window.octopus.projects.pullRequests(id)
      if (stopped) return

      // A refusal is an answer too: a repository with no GitHub remote never
      // gives another, and waiting on it would take the header's shortcut away
      // for good.
      const answer: ProjectAnswer = result.ok
        ? {
            byBranch: new Map(result.value.requests.map((request) => [request.branch, request])),
            capped: result.value.capped
          }
        : { byBranch: NONE, capped: false }
      setAnswers((current) => new Map(current).set(id, answer))

      const running = [...answer.byBranch.values()].some((request) => request.checks === 'running')

      // Rescheduled from the answer rather than run on an interval, so a slow
      // reply never has a second read stacked on top of it — and a refusal is
      // retried on the same clock rather than giving up for the session.
      timers.set(
        id,
        setTimeout(() => void read(id), running ? RUNNING_INTERVAL_MS : INTERVAL_MS)
      )
    }

    for (const id of watched.split('\n')) void read(id)

    return () => {
      stopped = true
      for (const timer of timers.values()) clearTimeout(timer)
    }
    // `nonce` is not read in here; it is what makes a refresh re-run the effect.
  }, [watched, nonce])

  const open = projectId === null ? undefined : answers.get(projectId)
  const byProject = useMemo(
    () => new Map([...answers].map(([id, answer]) => [id, answer.byBranch])),
    [answers]
  )

  return {
    byBranch: open?.byBranch ?? NONE,
    capped: open?.capped ?? false,
    answered: open !== undefined,
    refresh,
    byProject
  }
}
